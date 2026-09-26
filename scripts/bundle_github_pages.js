const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const outputDir = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

let indexHtml = fs.readFileSync(path.join(srcDir, 'Index.html'), 'utf8');

// Replace GAS template tags
indexHtml = indexHtml.replace(/<\?!= initialDataJson \?>/g, '"null"');

// Replace tab includes
const tabs = ['Tab1', 'Tab2', 'Tab3', 'Tab4', 'Tab5', 'Tab6', 'Tab7'];
tabs.forEach(tab => {
  const tabPath = path.join(srcDir, `${tab}.html`);
  if (fs.existsSync(tabPath)) {
    const tabContent = fs.readFileSync(tabPath, 'utf8');
    const regex = new RegExp(`<\\?!= include\\(['"]${tab}['"]\\); \\?>`, 'g');
    indexHtml = indexHtml.replace(regex, tabContent);
  }
});

// Polyfill script to inject in head
const polyfillScript = `
  <script>
    // Universal API bridge for Static GitHub Pages
    window.GAS_API_URL = "https://script.google.com/macros/s/AKfycbxclpPstjdG8eLHxRfM2QCJDMEglJ9GKC8VSJLb_RIpmPjcCtWKtfI183UXf9p3bXpFng/exec";
    
    (function() {
      if (typeof window.google === 'undefined') window.google = {};
      if (typeof window.google.script === 'undefined') window.google.script = {};

      function execApiCall(actionName, args, successCb, failureCb) {
        var callbackName = "gas_cb_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
        var payload = { action: actionName, args: args, data: args[0], callback: callbackName };
        var payloadStr = encodeURIComponent(JSON.stringify(payload));
        var scriptUrl = window.GAS_API_URL + "?action=" + encodeURIComponent(actionName) + "&callback=" + callbackName + "&payload=" + payloadStr;

        var script = document.createElement('script');
        var isDone = false;

        var timeoutId = setTimeout(function() {
          if (isDone) return;
          cleanup();
          fetch(scriptUrl, { method: 'GET', redirect: 'follow' })
          .then(function(res) { return res.json(); })
          .then(function(data) { if (successCb) successCb(data); })
          .catch(function(err) { if (failureCb) failureCb(err); });
        }, 15000);

        function cleanup() {
          isDone = true;
          if (script.parentNode) script.parentNode.removeChild(script);
          delete window[callbackName];
          clearTimeout(timeoutId);
        }

        window[callbackName] = function(data) {
          cleanup();
          if (successCb) successCb(data);
        };

        script.onerror = function(err) {
          cleanup();
          fetch(window.GAS_API_URL + "?action=" + encodeURIComponent(actionName) + "&payload=" + payloadStr, { method: 'GET', redirect: 'follow' })
          .then(function(res) { return res.json(); })
          .then(function(data) { if (successCb) successCb(data); })
          .catch(function(err2) {
            console.error("API error for " + actionName, err2);
            if (failureCb) failureCb(err2);
          });
        };

        script.src = scriptUrl;
        document.head.appendChild(script);
      }

      function createRunner(successCb, failureCb) {
        return new Proxy({}, {
          get: function(target, prop) {
            if (prop === 'withSuccessHandler') {
              return function(sCb) { return createRunner(sCb, failureCb); };
            }
            if (prop === 'withFailureHandler') {
              return function(fCb) { return createRunner(successCb, fCb); };
            }
            return function() {
              var args = Array.prototype.slice.call(arguments);
              return execApiCall(prop, args, successCb, failureCb);
            };
          }
        });
      }

      window.google.script.run = new Proxy({}, {
        get: function(target, prop) {
          if (prop === 'withSuccessHandler') {
            return function(sCb) { return createRunner(sCb, null); };
          }
          if (prop === 'withFailureHandler') {
            return function(fCb) { return createRunner(null, fCb); };
          }
          return function() {
            var args = Array.prototype.slice.call(arguments);
            return execApiCall(prop, args, null, null);
          };
        }
      });
    })();
  </script>
`;

indexHtml = indexHtml.replace('</head>', polyfillScript + '\n</head>');

const outputPath = path.join(outputDir, 'index.html');
fs.writeFileSync(outputPath, indexHtml, 'utf8');
console.log('Successfully generated dist/index.html! Total size:', (fs.statSync(outputPath).size / 1024).toFixed(2), 'KB');
