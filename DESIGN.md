# DESIGN.md — Señal Amarilla

Mundo visual del estudio Lyric Render (reemplazo total, mano 2, seed `e5981883`,
challenger `wayfinding-cartography-signage-terminal-yellow-wayfinding`,
elevado por elección del usuario).

## Tokens

- `--signal: #ffc400` — amarillo señal. Reservado a wayfinding: banda superior,
  números de puerta, focos, primaria. Nunca decoración.
- `--ground: #14120e` — terminal nocturno (cuarto del creador de noche).
- `--ground-deep: #0d0c09` — escenario (destino del pasillo).
- `--panel: #1b1712` — fichas de decisión. Regla fina `--line: #332c21`, 1px.
- `--ink: #f4ede0` — hueso. Secundario `--ink-dim: #c0b49e` (tinte cálido, jamás gris).
- `--signal-ink: #171106` — negro sobre amarillo (contraste ~10:1).
- Estado: `--ok: #9ad8a0`, `--err: #f0938c` (solo con significado).

## Tipo

- Estudio: Fira Sans autohospedada (`public/fonts/`, 400/500/700, `font-display: swap`),
  humanista de corte Frutiger, siempre en caja de oración. Números monumentales
  con `tabular-nums`; tracking nunca bajo `-0.02em`.
- Datos y medida: pila mono de sistema (`stage-spec`, LRC, hints `code`).
  La mono es para dato, nunca disfraz técnico.
- Salida del producto (canvas): conserva Quicksand. El video es la cara bajo la
  banda; el estudio es la señal sobre él. No se mezclan.

## Composición

Banda amarilla superior (marca + número de puerta del formato) → pasillo:
escenario protagonista a la izquierda, columna de tres decisiones numeradas a la
derecha (1 Música · 2 Portada y datos · 3 Letra), transporte abajo con primaria
amarilla sólida + flecha y secundaria fantasma. Radio de fichas 12–14px;
sombra siempre con offset y blur, jamás halo plano ni bloque duro.

## Movimiento firma

Cambio de banda: el número de puerta de cada ficha vive apagado y enciende en
amarillo al alcanzarse el cruce (`:focus-within`, paso 1 validado con
`input:valid`), con salida exponencial. La puerta seguida (`gateLabel`/`stageSpec`)
re-pinta su mensaje al cambiar el formato. Un solo momento, visible por defecto,
`prefers-reduced-motion` lo apaga.

## Estados y superficies

Focus-visible amarillo 3px; selección amarilla; scrollbar y caret del mundo;
`lookup-status` verde/roja solo con significado; `#status` es banda amarilla
con texto negro. Targets táctiles ≥48px; `dvh` y safe-area en móvil.

## Procedencia

Sin rásters generados en este mundo: tipografía open (Fira Sans, OFL),
pictograma SVG autorado inline, canvas del producto intacto. Nada que etiquetar.
