import {
  buildDynastyCostumePrompt,
  buildEthnicCostumePrompt,
  costumeDynastyItems,
  costumeEthnicItems,
  costumeImageMap,
  costumeVideoMap,
  foodShowcaseTemplates,
  paintingMotionTemplates,
} from './promptLibrary.js'

export const costumeEthnicTemplates = costumeEthnicItems.map(([id, title]) => ({
  id,
  title,
  group: 'ethnic',
  imageUrl: costumeImageMap[id] || '',
  videoUrl: costumeVideoMap[id] || '',
  prompt: buildEthnicCostumePrompt(id),
}))

export const costumeDynastyTemplates = costumeDynastyItems.map(([id, title]) => ({
  id,
  title,
  group: 'dynasty',
  imageUrl: costumeImageMap[id] || '',
  videoUrl: costumeVideoMap[id] || '',
  prompt: buildDynastyCostumePrompt(id),
}))

export const costumeStyleTemplates = [...costumeEthnicTemplates, ...costumeDynastyTemplates]

export { foodShowcaseTemplates, paintingMotionTemplates }

export function findCostumeStyle(templateIdOrTitle = '') {
  return (
    costumeStyleTemplates.find((template) => template.id === templateIdOrTitle) ||
    costumeStyleTemplates.find((template) => template.title === templateIdOrTitle)
  )
}

export function findPaintingStyle(styleIdOrTitle = '') {
  return (
    paintingMotionTemplates.find((template) => template.id === styleIdOrTitle) ||
    paintingMotionTemplates.find((template) => template.title === styleIdOrTitle)
  )
}
