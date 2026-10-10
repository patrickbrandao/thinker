# Marca do Thinker

Símbolo e logotipo do Thinker: um cérebro visto de cima, com os dois hemisférios separados pela fissura central e trilhas de circuito vazadas que saem da fissura e terminam num ponto de contato.

O desenho é **original do Thinker**. Ele parte do conceito do ícone Flaticon 5337422 (cérebro azul com circuitos), mas não copia nem adapta os traços dele: geometria, proporções, estilo e o desenho das trilhas são novos (ver #10). Por isso não há atribuição a terceiros.

## Arquivos

| Arquivo | Uso |
| --- | --- |
| `thinker-mark.svg` | Símbolo, para fundo claro. `viewBox` quadrado de 64. |
| `thinker-mark-dark.svg` | Símbolo, para fundo escuro. |
| `thinker-logo.svg` | Símbolo + palavra "Thinker", para fundo claro. |
| `thinker-logo-dark.svg` | Símbolo + palavra "Thinker", para fundo escuro. |
| `favicon.svg` | Favicon. Usa as cores claras e troca para as escuras quando o navegador está em tema escuro (`prefers-color-scheme`). |
| `favicon-32.png` | Favicon em PNG, 32 × 32, fundo transparente. |
| `apple-touch-icon.png` | Ícone de tela inicial do iOS, 180 × 180, fundo branco. |

As cópias de `thinker-logo.svg` e `thinker-logo-dark.svg` em `.github/assets/` servem ao README do repositório e devem ficar idênticas às desta pasta (um teste confere).

O sufixo `-dark` indica a variante **para fundo escuro**, não a cor do desenho.

## Cores

| Nome | Hex | Onde |
| --- | --- | --- |
| Azul profundo | `#1A56C4` | Hemisfério esquerdo, fundo claro |
| Azul | `#3A8DF0` | Hemisfério direito no fundo claro; hemisfério esquerdo no fundo escuro |
| Azul céu | `#7DBBFF` | Hemisfério direito, fundo escuro |
| Tinta | `#0E1E3D` | Palavra "Thinker", fundo claro |
| Névoa | `#EAF2FF` | Palavra "Thinker", fundo escuro |

As trilhas e a fissura são vazadas (transparentes), então mostram a cor do fundo. Não coloque o símbolo sobre fotos ou fundos com textura.

## Construção

- Grade de 64 unidades. Cada hemisfério é a união de cinco lobos circulares, cortada reta na fissura (6 unidades de largura).
- As trilhas têm 4 unidades de espessura, correm na horizontal e dobram a 45°. As bordas horizontais caem na grade de 4 unidades, que vira 1 px exato a 16 px e 2 px a 32 px.
- O hemisfério esquerdo tem duas trilhas e o direito, três, em alturas alternadas.
- A palavra "Thinker" é desenhada com caminhos geométricos (traço de 6 unidades), sem fonte. A CSP do painel não permite fontes externas.

Os SVGs são escritos à mão: sem metadados de editor, com `role="img"` e `<title>`.

## Regerar os PNGs

```sh
magick -background none -density 1152 favicon.svg -resize 32x32 -strip PNG32:favicon-32.png
magick -background none -density 1152 thinker-mark.svg -resize 136x136 \
  -background white -gravity center -extent 180x180 -flatten -strip PNG24:apple-touch-icon.png
```

## Onde é usado

Ainda em lugar nenhum. A aplicação no painel fica com a #25 e o README com a #33.
