/* menmen: 手写工具栏 SVG（24×24，参考 Tabler / Lucide 造型，填色便于小尺寸辨认） */
'use strict'

export function inkToolSvg (tool, inkColor, colorSwatch) {
  const c = inkColor || '#111111'
  const sw = colorSwatch || c
  switch (tool) {
    case 'color':
      return (
        '<path d="M12 3c-4.5 0-8 3.6-8 8.1 0 2.2 1.8 4 4 4h1.2c.6 0 1.1.5 1.1 1.1V18c0 1.1.9 2 2 2h1.4c1.1 0 2-.9 2-2v-1.8c0-.6.5-1.1 1.1-1.1H16c2.2 0 4-1.8 4-4C20 6.6 16.4 3 12 3z" fill="' + sw + '" fill-opacity="0.25" stroke="#546E7A" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<circle cx="8.5" cy="10" r="1.6" fill="#E5484D"/>' +
        '<circle cx="12" cy="7.5" r="1.6" fill="#F76B15"/>' +
        '<circle cx="15.5" cy="10" r="1.6" fill="#F5D90A"/>' +
        '<circle cx="14.2" cy="13.8" r="1.6" fill="#30A46C"/>' +
        '<circle cx="9.8" cy="13.8" r="1.6" fill="#3E63DD"/>' +
        '<circle cx="12" cy="12" r="1.3" fill="#fff" stroke="#90A4AE" stroke-width="0.7"/>'
      )
    case 'eraser':
      return (
        '<path d="M4.5 16.2 13.8 6.9c.6-.6 1.5-.6 2.1 0l3.6 3.6c.6.6.6 1.5 0 2.1L10.2 22H5.5c-.8 0-1.5-.7-1.5-1.5v-3.2c0-.4.2-.8.5-1.1z" fill="#F8BBD9" stroke="#D81B60" stroke-width="0.9" stroke-linejoin="round"/>' +
        '<path d="M10.2 22 19.5 12.7l2.8 2.8L13 22.8 10.2 22z" fill="#F48FB1" stroke="#D81B60" stroke-width="0.7" stroke-linejoin="round"/>' +
        '<path d="M13.8 6.9 16.8 4c.4-.4 1-.4 1.4 0l1.4 1.4c.4.4.4 1 0 1.4l-2.8 2.8-3.6-3.6z" fill="#B39DDB" stroke="#7E57C2" stroke-width="0.6" stroke-linejoin="round"/>' +
        '<path d="M5.2 19.8h4.2" stroke="#AD1457" stroke-width="1" stroke-linecap="round" opacity="0.5"/>'
      )
    case 'brush':
      return (
        '<path d="M11.2 2.8h1.6c.5 0 .9.4.9.9v7.2c0 .5-.4.9-.9.9h-1.6c-.5 0-.9-.4-.9-.9V3.7c0-.5.4-.9.9-.9z" fill="#6D4C41" stroke="#4E342E" stroke-width="0.55"/>' +
        '<path d="M8.2 11.2c0-1.2 1.7-2.2 3.8-2.2s3.8 1 3.8 2.2-1.7 4.8-3.8 6.8-3.8-5.6-3.8-6.8z" fill="' + c + '" stroke="#263238" stroke-width="0.65" stroke-linejoin="round"/>' +
        '<path d="M9.5 13.5c1.2.8 2.8.8 4 0" fill="none" stroke="#fff" stroke-width="0.6" stroke-linecap="round" opacity="0.35"/>' +
        '<ellipse cx="12" cy="11.2" rx="3.2" ry="1.1" fill="' + c + '" opacity="0.25"/>'
      )
    case 'fineliner':
      return (
        '<rect x="9" y="2.2" width="6" height="15.2" rx="2.8" fill="#37474F" stroke="#263238" stroke-width="0.65"/>' +
        '<rect x="10" y="3.5" width="4" height="5.5" rx="1.2" fill="#546E7A"/>' +
        '<rect x="10.8" y="4.2" width="2.4" height="1.2" rx="0.4" fill="#90A4AE" opacity="0.8"/>' +
        '<path d="M10.2 17.4h3.6l-1.8 4.2-1.8-4.2z" fill="' + c + '" stroke="#111" stroke-width="0.45" stroke-linejoin="round"/>' +
        '<path d="M12 21.6v.8" stroke="#111" stroke-width="0.9" stroke-linecap="round"/>'
      )
    case 'pencil':
      return (
        '<path d="M16.8 3.2 20.8 7.2 8.6 19.4 4.6 19.4 4.6 15.4 16.8 3.2z" fill="#FFCC80" stroke="#A1887F" stroke-width="0.75" stroke-linejoin="round"/>' +
        '<path d="M16.8 3.2 18.6 1.4 20.8 3.6 19 5.4 16.8 3.2z" fill="#EF5350" stroke="#C62828" stroke-width="0.55" stroke-linejoin="round"/>' +
        '<path d="M18.6 1.4 20.8 3.6 19.8 4.6 17.6 2.4 18.6 1.4z" fill="#FFCDD2" opacity="0.9"/>' +
        '<path d="M8.6 19.4 6.8 21.2 4.6 19.4 6.4 17.6 8.6 19.4z" fill="#455A64" stroke="#263238" stroke-width="0.5" stroke-linejoin="round"/>' +
        '<path d="M15.2 4.8 19.2 8.8" stroke="#FFE0B2" stroke-width="0.9" stroke-linecap="round" opacity="0.65"/>'
      )
    case 'ballpoint':
    default:
      return (
        '<path d="M10.2 2.5h3.6c.8 0 1.5.7 1.5 1.5v11.8c0 .8-.7 1.5-1.5 1.5h-3.6c-.8 0-1.5-.7-1.5-1.5V4c0-.8.7-1.5 1.5-1.5z" fill="#E3F2FD" stroke="#1976D2" stroke-width="0.75"/>' +
        '<path d="M13.4 3.2v12.4" stroke="#1565C0" stroke-width="0.55" opacity="0.35"/>' +
        '<path d="M14.8 5.2c.6-.3 1.2-.2 1.5.4.3.6-.1 1.3-.7 1.6-.6.3-1.2.1-1.5-.4-.3-.5.1-1.2.7-1.6z" fill="#78909C" stroke="#546E7A" stroke-width="0.45"/>' +
        '<path d="M10.2 15.8h3.6l-1.8 4.5-1.8-4.5z" fill="' + c + '" stroke="#212121" stroke-width="0.55" stroke-linejoin="round"/>' +
        '<circle cx="12" cy="4.8" r="0.65" fill="#90CAF9"/>'
      )
  }
}

export function inkToggleSvg () {
  return ''
}
