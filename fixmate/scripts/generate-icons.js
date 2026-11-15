const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
const root = path.resolve(__dirname, '..');
const color = '#0B6E6E';
const foregroundSvg = await fs.readFile(path.join(root, 'assets', 'icon-foreground.svg'));
const foreground = await sharp(foregroundSvg).png().toBuffer();
const squareIcon = await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: color },
}).composite([{ input: foreground }]).png().toBuffer();

await sharp(squareIcon).resize(512, 512).png().toFile(path.join(root, 'assets', 'fixmate-play-icon.png'));

const densities = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

for (const [density, launcherSize, foregroundSize] of densities) {
  const directory = path.join(root, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`);
  await fs.mkdir(directory, { recursive: true });
  const launcher = sharp(squareIcon).resize(launcherSize, launcherSize).png();
  await launcher.toFile(path.join(directory, 'ic_launcher.png'));
  await sharp(squareIcon).resize(launcherSize, launcherSize).png().toFile(path.join(directory, 'ic_launcher_round.png'));
  await sharp(foregroundSvg).resize(foregroundSize, foregroundSize).png()
    .toFile(path.join(directory, 'ic_launcher_foreground.png'));
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});