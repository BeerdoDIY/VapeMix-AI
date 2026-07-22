// Declare global Promise interface extension for TypeScript
declare global {
  interface PromiseConstructor {
    withResolvers<T = any>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: any) => void;
    };
  }
}

// Polyfill for Promise.withResolvers for older browsers (e.g., Safari < 17.4)
if (typeof Promise.withResolvers === 'undefined') {
  Promise.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Polyfill for Object.hasOwn for older browsers (e.g., Safari < 15.4)
if (typeof Object.hasOwn === 'undefined') {
  Object.hasOwn = function(object, property) {
    return Object.prototype.hasOwnProperty.call(object, property);
  };
}

// Polyfill for ReadableStream.prototype[Symbol.asyncIterator] for older Safari/iOS versions
if (typeof ReadableStream !== 'undefined' && !(ReadableStream.prototype as any)[Symbol.asyncIterator]) {
  (ReadableStream.prototype as any)[Symbol.asyncIterator] = function() {
    const reader = this.getReader();
    return {
      async next() {
        try {
          const { done, value } = await reader.read();
          return { done, value };
        } catch (e) {
          reader.releaseLock();
          throw e;
        }
      },
      async return() {
        reader.releaseLock();
        return { done: true, value: undefined };
      }
    };
  };
}

export {};
