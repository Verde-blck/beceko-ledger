# Brands

Each folder here is one look for the app: its name, colours and icons. A copy of the app picks its folder with the `BRAND` setting, for example `BRAND=beceko`. Without it, the app uses `iwe-oja`.

A brand folder holds:

- `brand.json` with the app name, the short name for the home screen, and two accent colours (one for light mode, one for dark mode):

  ```json
  {
    "appName": "Mama Tola Stores",
    "shortName": "Mama Tola",
    "accent": "#8a3fb0",
    "accentDark": "#d4a7ef"
  }
  ```

  Keep `shortName` to about 12 characters, because phones cut off longer names under the icon. For any brand other than Ìwé Ọjà, the sign-in page says "Runs on Ìwé Ọjà". Add `"showPoweredBy": false` to hide it.

- The icons, all made from the business's logo on a solid background:
  - `icons/icon-192.png` (192 × 192) and `icons/icon-512.png` (512 × 512)
  - `icons/maskable-512.png` (512 × 512, with the logo inside the middle 80% so Android can crop it to a circle)
  - `icons/apple-touch-icon.png` (180 × 180, no transparency)
  - `favicon.ico` (16, 32 and 48 pixels) and `icon.svg` for the browser tab

Folder names use lower-case letters, digits and hyphens only. The app checks every brand file at start-up and refuses to start if one is missing, so a broken brand shows up in the deploy log rather than on a customer's phone.
