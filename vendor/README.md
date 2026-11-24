# Vendored Firebase SDK

Firebase JS SDK compat builds, version **10.7.0**, copied unmodified from the npm package
`firebase@10.7.0` (`npm pack firebase@10.7.0`, files at the package root). They attach to a global
`firebase` object and are loaded as classic scripts. Nothing is loaded from a CDN.

| File | SHA-256 |
| --- | --- |
| `firebase-app-compat.js` | `dfcf14c04516a8267944104042847cbcad53cbcab3c6a3ff89addcaf844291e8` |
| `firebase-auth-compat.js` | `11cb4cd0e8668919ac06f1be5f763d999f27fc79ea0f20e98182d74d6819f4e2` |
| `firebase-firestore-compat.js` | `ed328bc02a333eb86fb0e4bb16e484a507a5e1ab91580e68422a80036432317a` |
| `firebase-messaging-compat.js` | `33424948935d3a5f2c21d3f6c96c018eb5cfe7b2ddec00be94f0ae3cf5be3ba3` |

To check: `shasum -a 256 vendor/*.js`.

# Vendored charts

TradingView Lightweight Charts **4.2.3** (Apache-2.0), `dist/lightweight-charts.standalone.production.js` copied unmodified from
the npm package `lightweight-charts@4.2.3` (tarball integrity `sha512-5kS/2hY3wNYNzhnS8Gb+GAS07DX8GPF2YVDnd2NMC85gJVQ6RLU6YrXNgNJ6eg0AnWPwCnvaGtYmGky3HiLQEw==`).
It is byte-identical to the copy in the Mac app. It attaches a global `LightweightCharts` and is loaded as a classic script; nothing comes from a CDN.

| File | SHA-256 |
| --- | --- |
| `lightweight-charts.standalone.production.js` | `c7dda807d662a95b3d257119ed315cec669e3bdf5aaece75c480a39307f23540` |
