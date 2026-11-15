/**
 * Proxy module standing in for api/db-client.js under test.
 * Delegates every property access to the fake client the test installed.
 */
import { get } from './db-singleton.mjs';

const proxy = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = get();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
    has() {
      return true;
    },
  }
);

export default proxy;
