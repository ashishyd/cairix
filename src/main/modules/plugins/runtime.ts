/**
 * The script injected into every plugin's sandboxed window BEFORE the plugin's
 * own code. It defines the `cairix` global the plugin sees. It is plain JS in a
 * string because it runs inside the sandbox, not in the app.
 *
 * Nothing here is security-critical: the sandbox and the broker in main are the
 * boundary. A plugin that tampers with this object only hurts itself.
 */
export const RUNTIME_SOURCE = String.raw`
(function () {
  'use strict';
  var host = window.__host;
  var defs = { commands: {}, widgets: {}, tabs: {}, actions: {} };
  var registered = false;

  function clean(e) {
    return new Error(String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
  }
  function call(method, args) {
    return host.call(method, args === undefined ? null : args).catch(function (e) { throw clean(e); });
  }

  var api = {
    plugin: {
      register: function (d) {
        if (registered) throw new Error('cairix.plugin.register() may only be called once');
        registered = true;
        ['commands', 'widgets', 'tabs', 'actions'].forEach(function (group) {
          var g = d && d[group];
          if (!g) return;
          Object.keys(g).forEach(function (id) {
            if (typeof g[id] !== 'function') throw new Error(group + '.' + id + ' must be a function');
            defs[group][id] = g[id];
          });
        });
      }
    },
    projects: { list: function () { return call('projects.list'); } },
    ports: { list: function () { return call('ports.list'); } },
    agents: { list: function () { return call('agents.list'); } },
    storage: {
      get: function (key) { return call('storage.get', { key: key }); },
      set: function (key, value) { return call('storage.set', { key: key, value: value }); },
      delete: function (key) { return call('storage.delete', { key: key }); },
      keys: function () { return call('storage.keys'); }
    },
    http: { fetch: function (url, options) { return call('http.fetch', Object.assign({ url: url }, options || {})); } },
    ui: {
      notify: function (message, kind) { return call('ui.notify', { message: message, kind: kind }); },
      openUrl: function (url) { return call('ui.openUrl', { url: url }); }
    }
  };
  Object.defineProperty(window, 'cairix', { value: Object.freeze(api), enumerable: true });

  host.onInvoke(function (msg) {
    var reqId = msg.reqId, kind = msg.kind, id = msg.id, payload = msg.payload;
    Promise.resolve().then(function () {
      var group = { command: 'commands', widget: 'widgets', tab: 'tabs', action: 'actions' }[kind];
      var fn = group && defs[group][id];
      if (!fn) throw new Error('This plugin has not registered a ' + kind + ' called "' + id + '".');
      return fn(payload);
    }).then(
      function (result) { host.reply(reqId, { ok: true, result: result === undefined ? null : result }); },
      function (e) { host.reply(reqId, { ok: false, error: String((e && e.message) || e) }); }
    );
  });
})();
`
