// Gera o ícone do app (fichário branco com grade de cartas sobre o vermelho Pokémon), o ícone adaptativo do
// Android, a imagem da abertura e o favicon. Rode com: node scripts/make-icons.js
// Desenho por coordenadas de 0 a 1, com 4×4 amostras por pixel para suavizar as bordas.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const RED = [227, 53, 13];
const WHITE = [255, 255, 255];
const POCKET = [223, 226, 233];
const YELLOW = [255, 203, 5];
const RING = [34, 38, 46];

/** Formas do fichário, em coordenadas 0–1 do desenho. */
function binderShapes(ink) {
  const shapes = [{ type: 'rrect', x0: 0.24, y0: 0.17, x1: 0.78, y1: 0.83, r: 0.06, color: ink.body }];
  // Argolas do fichário.
  for (const y of [0.32, 0.5, 0.68]) shapes.push({ type: 'circle', cx: 0.31, cy: y, r: 0.03, color: ink.ring });
  // Página com 3×3 bolsos; o do meio é uma carta especial (amarela).
  const gx0 = 0.39, gx1 = 0.72, gy0 = 0.24, gy1 = 0.76, gap = 0.022;
  const cw = (gx1 - gx0 - gap * 2) / 3, ch = (gy1 - gy0 - gap * 2) / 3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x0 = gx0 + c * (cw + gap), y0 = gy0 + r * (ch + gap);
      shapes.push({ type: 'rrect', x0, y0, x1: x0 + cw, y1: y0 + ch, r: 0.015, color: r === 1 && c === 1 ? ink.special : ink.pocket });
    }
  }
  return shapes;
}

function inside(s, x, y) {
  if (s.type === 'circle') return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r ** 2;
  if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) return false;
  const cx = Math.min(Math.max(x, s.x0 + s.r), s.x1 - s.r);
  const cy = Math.min(Math.max(y, s.y0 + s.r), s.y1 - s.r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= s.r ** 2;
}

/**
 * Desenha um PNG `size`×`size`. `bg` = cor de fundo (ou null = transparente); `scale` encolhe o desenho em
 * volta do centro (área segura do ícone adaptativo do Android).
 */
function render(file, size, { bg, ink, scale = 1 }) {
  const png = new PNG({ width: size, height: size });
  const shapes = binderShapes(ink);
  const SS = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = 0.5 + ((px + (sx + 0.5) / SS) / size - 0.5) / scale;
          const y = 0.5 + ((py + (sy + 0.5) / SS) / size - 0.5) / scale;
          let col = bg, alpha = bg ? 1 : 0;
          for (const s of shapes) if (inside(s, x, y)) (col = s.color), (alpha = 1);
          if (alpha) (r += col[0]), (g += col[1]), (b += col[2]), (a += 1);
        }
      }
      const i = (py * size + px) * 4;
      png.data[i] = a ? Math.round(r / a) : 0;
      png.data[i + 1] = a ? Math.round(g / a) : 0;
      png.data[i + 2] = a ? Math.round(b / a) : 0;
      png.data[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'images', file), PNG.sync.write(png));
  console.log('ok', file, size);
}

const color = { body: WHITE, ring: RING, pocket: POCKET, special: YELLOW };
const mono = { body: WHITE, ring: [0, 0, 0, 0], pocket: WHITE, special: WHITE };

render('icon.png', 1024, { bg: RED, ink: color });
render('favicon.png', 48, { bg: RED, ink: color });
render('splash-icon.png', 288, { bg: null, ink: color });
// Android adaptativo: o desenho fica dentro da área segura (66% central).
render('android-icon-foreground.png', 512, { bg: null, ink: color, scale: 0.62 });
render('android-icon-background.png', 512, { bg: RED, ink: { body: RED, ring: RED, pocket: RED, special: RED } });
render('android-icon-monochrome.png', 432, { bg: null, ink: mono, scale: 0.62 });
