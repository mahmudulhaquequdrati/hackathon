const pptxgen = require('pptxgenjs');
const path = require('path');
const fs = require('fs');
const html2pptx = require('/Users/mahmudqudrati/.claude/plugins/cache/anthropic-agent-skills/example-skills/00756142ab04/skills/pptx/scripts/html2pptx');

const slidesDir = path.join(__dirname, 'slides');
const mapImage = '/Users/mahmudqudrati/hackathon_2/map-screenshot.png';
const supplyImage = '/Users/mahmudqudrati/hackathon_2/add_new_supply.png';

const slideFiles = [
  'slide01-title.html',
  'slide02-problem.html',
  'slide03-solution.html',
  'slide04-techstack.html',
  'slide05-architecture.html',
  'slide06-modules1.html',
  'slide07-modules2.html',
  'slide08-crdt.html',
  'slide09-ml.html',
  'slide10-routing.html',
  'slide11-security.html',
  'slide13-thankyou.html',
];

async function build() {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Team Digital Delta';
  pptx.title = 'Digital Delta - Offline-First Disaster Relief Logistics';

  for (const file of slideFiles) {
    console.log(`Processing ${file}...`);
    const { slide, placeholders } = await html2pptx(path.join(slidesDir, file), pptx);

    // Embed map screenshot on routing slide
    if (file === 'slide10-routing.html' && fs.existsSync(mapImage)) {
      const ph = placeholders.find(p => p.id === 'map-img');
      if (ph) {
        const aspect = 1284 / 2604;
        const imgH = ph.h;
        const imgW = imgH * aspect;
        const imgX = ph.x + (ph.w - imgW) / 2;
        slide.addImage({ path: mapImage, x: imgX, y: ph.y, w: imgW, h: imgH });
        console.log('  -> Map image embedded');
      }
    }

    // Embed supply screenshot on solution slide
    if (file === 'slide03-solution.html' && fs.existsSync(supplyImage)) {
      const ph = placeholders.find(p => p.id === 'supply-img');
      if (ph) {
        const aspect = 1280 / 1271;
        const imgH = ph.h;
        const imgW = imgH * aspect;
        const imgX = ph.x + (ph.w - imgW) / 2;
        slide.addImage({ path: supplyImage, x: imgX, y: ph.y, w: imgW, h: imgH });
        console.log('  -> Supply image embedded');
      }
    }
  }

  const outPath = '/Users/mahmudqudrati/hackathon_2/Digital_Delta_Presentation.pptx';
  await pptx.writeFile({ fileName: outPath });
  console.log(`\nSaved: ${outPath}`);
  console.log(`Slides: ${slideFiles.length}`);
}

build().catch(err => { console.error(err); process.exit(1); });
