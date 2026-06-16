# Quest MR Glass Demo

This folder is a static WebXR viewer for Meta Quest 3.

Open `index.html` from an HTTPS URL in Quest Browser, press `Start Quest MR`, then tap a detected surface to place the glass model.

Local HTTP preview is useful on desktop, but Quest AR sessions require a secure context. Deploy this folder to any HTTPS static host such as Netlify, Cloudflare Pages, or GitHub Pages for headset viewing.

For a static host, publish the contents of this `quest-mr` folder as the site root. The included `_headers` file sets the GLB MIME type for hosts that support Netlify-style headers.
