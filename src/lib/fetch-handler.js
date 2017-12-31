const ResponseBuilder = require('./response-builder');

const FetchMock = {};

FetchMock.fetchHandler = function (url, opts) {

	let response = this.executeRouter(url, opts);

	// If the response says to throw an error, throw it
	// It only makes sense to do this before doing any async stuff below
	// as the async stuff swallows catastrophic errors in a promise
	// Type checking is to deal with sinon spies having a throws property :-0
	if (response.throws && typeof response !== 'function') {
		throw response.throws;
	}

	// this is used to power the .flush() method
	let done
	this._holdingPromises.push(new this.config.Promise(res => done = res));

	// wrapped in this promise to make sure we respect custom Promise
	// constructors defined by the user
	return new this.config.Promise((res, rej) => {
		this.generateResponse(response, url, opts)
			.then(res, rej)
			.then(done, done);
	})
}

FetchMock.fetchHandler.isMock = true;

FetchMock.executeRouter = function (url, opts) {

	let response = this.router(url, opts);
	if (!response) {
		this.config.warnOnFallback && console.warn(`Unmatched ${opts && opts.method || 'GET'} to ${url}`);
		this.push(null, [url, opts]);

		if (this.fallbackResponse) {
			response = this.fallbackResponse;
		} else if (this.config.fallbackToNetwork) {
			if (this.isSandbox) {
				if (!this.config.fetch) {
					throw 'to fallbackToNetwork when using a sanboxed fetch-mock set fetchMock.config.fetch to your chosen fetch implementation';
				}
				response = this.config.fetch
			} else {
				response = this.realFetch;
			}
		} else {
			throw new Error(`No fallback response defined for ${opts && opts.method || 'GET'} to ${url}`)
		}
	}
	return response;
}

FetchMock.generateResponse = async function (response, url, opts) {
	// We want to allow things like
	// - function returning a Promise for a response
	// - delaying (using a timeout Promise) a function's execution to generate
	//   a response
	// Because of this we can't safely check for function before Promisey-ness,
	// or vice versa. So to keep it DRY, and flexible, we keep trying until we
	// have something that looks like neither Promise nor function
	while (typeof response === 'function' || typeof response.then === 'function') {
		if (typeof response === 'function') {
			response = response(url, opts);
		} else {
			// Strange .then is to cope with non ES Promises... god knows why it works
			response = await response.then(it => it)
		}
	}

	// If the response is a pre-made Response, respond with it
	if (this.config.Response.prototype.isPrototypeOf(response)) {
		return response;
	}

	// finally, if we need to convert config into a response, we do it
	return new ResponseBuilder(url, response, this).exec();
}


FetchMock.router = function (url, opts) {
	const route = this.routes.find(route => route.matcher(url, opts));

	if (route) {
		this.push(route.name, [url, opts]);
		return route.response;
	}
}

FetchMock.push = function (name, args) {
	if (name) {
		this._calls[name] = this._calls[name] || [];
		this._calls[name].push(args);
		this._matchedCalls.push(args);
	} else {
		this._unmatchedCalls.push(args);
	}
};

module.exports = FetchMock;