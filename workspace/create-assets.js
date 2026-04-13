const sharp = require('sharp');
const path = require('path');
const dir = path.join(__dirname, 'slides');

async function createGradient(filename, color1, color2, angle = '135') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="810">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${color1}"/>
        <stop offset="100%" style="stop-color:${color2}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(dir, filename));
}

async function createAccentBar(filename, color, w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="${color}" rx="4"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(dir, filename));
}

async function createCircle(filename, color, size, opacity = 0.15) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="${color}" opacity="${opacity}"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(dir, filename));
}

(async () => {
  await createGradient('bg-dark.png', '#030712', '#0f172a');
  await createGradient('bg-title.png', '#030712', '#0c1220');
  await createGradient('bg-thankyou.png', '#0c1220', '#030712');
  await createAccentBar('bar-cyan.png', '#06b6d4', 6, 200);
  await createAccentBar('bar-amber.png', '#f59e0b', 6, 200);
  await createAccentBar('bar-green.png', '#22c55e', 6, 200);
  await createAccentBar('bar-top-cyan.png', '#06b6d4', 720, 4);
  await createCircle('circle-cyan.png', '#06b6d4', 300, 0.08);
  await createCircle('circle-amber.png', '#f59e0b', 200, 0.06);
  console.log('Assets created');
})();
