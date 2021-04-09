/*
Copyright 2020 Bruno Windels <bruno@windels.cloud>
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import {ConnectionError} from "../matrix/error.js";


export function abortOnTimeout(createTimeout, timeoutAmount, requestResult, responsePromise) {
    const timeout = createTimeout(timeoutAmount);
    // abort request if timeout finishes first
    let timedOut = false;
    timeout.elapsed().then(
        () => {
            timedOut = true;
            requestResult.abort();
        },
        () => {}    // ignore AbortError when timeout is aborted
    );
    // abort timeout if request finishes first
    return responsePromise.then(
        response => {
            timeout.abort();
            return response;
        },
        err => {
            timeout.abort();
            // map error to TimeoutError
            if (err.name === "AbortError" && timedOut) {
                throw new ConnectionError(`Request timed out after ${timeoutAmount}ms`, true);
            } else {
                throw err;
            }
        }
    );
}

// because impunity only takes one entrypoint currently,
// these tests aren't run by yarn test as that does not
// include platform specific code,
// and this file is only included by platform specific code,
// see how to run in package.json and replace src/main.js with this file.
import {Clock} from "../mocks/Clock.js";
import {AbortError} from "../matrix/error.js";
export function tests() {
    function createRequest() {
        let request = {
            abort() {
                this.aborted = true;
                this.reject(new AbortError());
            }
        };
        request.responsePromise = new Promise((resolve, reject) => {
            request.resolve = resolve;
            request.reject = reject;
        });
        return request;
    }

    return {
        "ConnectionError on timeout": async assert => {
            const clock = new Clock();
            const request = createRequest();
            const promise = abortOnTimeout(clock.createTimeout, 10000, request, request.responsePromise);
            clock.elapse(10000);
            await assert.rejects(promise, ConnectionError);
            assert(request.aborted);
        },
        "Abort is canceled once response resolves": async assert => {
            const clock = new Clock();
            const request = createRequest();
            const promise = abortOnTimeout(clock.createTimeout, 10000, request, request.responsePromise);
            request.resolve(5);
            clock.elapse(10000);
            assert(!request.aborted);
            assert.equal(await promise, 5);
        },
        "AbortError from request is not mapped to ConnectionError": async assert => {
            const clock = new Clock();
            const request = createRequest();
            const promise = abortOnTimeout(clock.createTimeout, 10000, request, request.responsePromise);
            request.reject(new AbortError());
            assert(!request.aborted);
            assert.rejects(promise, AbortError);
        }
    }

}
