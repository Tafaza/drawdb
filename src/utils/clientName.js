const STORAGE_KEY = "drawdb:collabClientName"

const ADJECTIVES = [
  "Brave",
  "Calm",
  "Clever",
  "Curious",
  "Fast",
  "Gentle",
  "Happy",
  "Kind",
  "Lucky",
  "Swift",
]

const ANIMALS = [
  "Otter",
  "Panda",
  "Fox",
  "Koala",
  "Hawk",
  "Dolphin",
  "Tiger",
  "Turtle",
  "Wombat",
  "Wolf",
]

function hashString(input) {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function generateRandomClientName() {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  const number = Math.floor(Math.random() * 1000).toString().padStart(3, "0")
  return `${adjective} ${animal} ${number}`
}

export function getStableClientNameFromId(clientId = "") {
  const hash = hashString(String(clientId || ""))
  const adjective = ADJECTIVES[hash % ADJECTIVES.length]
  const animal = ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length]
  const number = (hash % 1000).toString().padStart(3, "0")
  return `${adjective} ${animal} ${number}`
}

export function loadClientName() {
  try {
    return localStorage.getItem(STORAGE_KEY) || ""
  } catch {
    return ""
  }
}

export function saveClientName(name) {
  try {
    localStorage.setItem(STORAGE_KEY, name)
  } catch {
    // ignore
  }
}
