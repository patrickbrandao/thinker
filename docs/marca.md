# Marca do Thinker

Símbolo e logotipo do Thinker: um cérebro visto de frente, em tons de azul com contorno azul-marinho, os dois hemisférios separados pela fissura central e cruzados por uma rede de conexões com nós.

## Arquivos

O original do símbolo é um PNG de 256 × 256 com fundo transparente (versões de 512 e 1024 guardadas fora do repositório). Os assets derivados ficam em `packages/frontend/public/brand/`.

| Arquivo | Uso |
| --- | --- |
| `thinker-mark.png` | Símbolo, 256 × 256, fundo transparente. Serve em fundo claro e escuro. Também é o ícone grande da aba. |
| `thinker-logo.png` | Símbolo + palavra "Thinker", para fundo claro. 128 px de altura. |
| `thinker-logo-dark.png` | Símbolo + palavra "Thinker", para fundo escuro. Mesmo tamanho. |
| `favicon-32.png` | Favicon em PNG, 32 × 32, fundo transparente. |
| `apple-touch-icon.png` | Ícone de tela inicial do iOS, 180 × 180, fundo branco. |

Fora de `brand/`, em `packages/frontend/public/`:

| Arquivo | Uso |
| --- | --- |
| `favicon.ico` | Favicon legado, 16, 32 e 48 px. |
| `thinker-logo.png` | Logo dos e-mails (fundo branco), 256 px de altura. |

As cópias de `thinker-logo.png` e `thinker-logo-dark.png` em `.github/assets/` servem ao README do repositório e devem ficar idênticas às de `public/brand/`. O teste `packages/frontend/tests/brand-assets.test.ts` confere isso.

O sufixo `-dark` indica a variante **para fundo escuro**, não a cor do desenho.

Os arquivos em `/brand/*` são servidos sem hash no nome e com cache `immutable` de um ano. Ao trocar um desenho, suba `BRAND_ASSET_VERSION` em `packages/frontend/src/services/thinker-links.ts` e o `?v=` de `index.html`.

## Cores

| Nome | Hex | Onde |
| --- | --- | --- |
| Tinta | `#0E1E3D` | Palavra "Thinker", fundo claro |
| Névoa | `#EAF2FF` | Palavra "Thinker", fundo escuro |

A palavra "Thinker" é desenhada com caminhos geométricos (traço de 6 unidades numa grade de 64), sem fonte, e rasterizada junto com o símbolo.

## Regerar os PNGs

Com ImageMagick, a partir do símbolo original `mark.png` (256 × 256) e de um SVG `word.svg` (ou `word-dark.svg`) que contém só o caminho da palavra, `viewBox="0 0 256 64"` com a palavra começando em x = 80:

```sh
magick mark.png -resize 32x32 -strip PNG32:favicon-32.png
magick mark.png -resize 152x152 -background white -gravity center -extent 180x180 -flatten -strip PNG24:apple-touch-icon.png
magick mark.png -define icon:auto-resize=48,32,16 ../favicon.ico

# Logo com altura H (128 no painel, 256 no e-mail): palavra recortada, 1/8 de H de espaço após o símbolo.
H=128
magick -background none -density $((H*3/2)) word.svg -resize x$H -crop $((H*3))x$H+$((H*5/4))+0 +repage -trim +repage w.png
W=$(magick identify -format %w w.png)
magick -size $((H + H/8 + W))x$H xc:none \( mark.png -resize ${H}x$H \) -composite \
  w.png -gravity west -geometry +$((H + H/8))+0 -composite -strip PNG32:thinker-logo.png
```

## Onde é usado

- Painel: barra lateral, telas de login e boas-vindas (`thinker-logo*.png`), ícone do provedor Thinker (`thinker-mark.png`), favicons em `index.html`.
- E-mails: `thinker-logo.png` da raiz de `public/`.
- README, `app.json` e `deploy/gcp/deploystack.json`: `.github/assets/thinker-logo*.png`.
