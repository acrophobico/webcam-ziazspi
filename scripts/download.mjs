import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

// --- Configurazione webcam ---
const WEBCAMS = [
  { id: 'campetto',  url: 'https://www.scuolascispiazzi.it/webcam/campetto.jpg' },
  { id: 'pagherolo', url: 'https://www.scuolascispiazzi.it/webcam/pagherolo.jpg' },
  { id: 'current',   url: 'https://www.spiazzidigromo.it/joomla/webcam/current.jpg' },
  { id: 'current2',  url: 'https://www.spiazzidigromo.it/joomla/webcam/current2.jpg' },
];

// --- Client R2 (compatibile S3) ---
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;

// --- Helpers ---

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}`;
  return { date, time };
}

async function fetchImage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; webcam-archiver/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} per ${url}`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer);
}

async function uploadToR2(key, imageBuffer) {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: imageBuffer,
    ContentType: 'image/jpeg',
  }));
}

async function updateIndex(newEntries) {
  // Legge l'indice esistente da R2 (se esiste)
  let existingIndex = [];
  try {
    const { Contents } = await r2.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: 'images/',
    }));
    if (Contents) {
      existingIndex = Contents.map(obj => obj.Key);
    }
  } catch {
    // Prima esecuzione, nessun indice ancora
  }

  // Aggiunge i nuovi file all'indice
  const allKeys = [...new Set([...existingIndex, ...newEntries])].sort().reverse();

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: 'index.json',
    Body: JSON.stringify(allKeys),
    ContentType: 'application/json',
  }));

  console.log(`Indice aggiornato: ${allKeys.length} file totali`);
}

// --- Main ---

async function main() {
  const { date, time } = getTimestamp();
  console.log(`Avvio download — ${date} ${time} UTC`);

  const uploadedKeys = [];

  for (const cam of WEBCAMS) {
    const key = `images/${date}/${time}_${cam.id}.jpg`;
    try {
      console.log(`  Scarico ${cam.id}...`);
      const buffer = await fetchImage(cam.url);
      await uploadToR2(key, buffer);
      uploadedKeys.push(key);
      console.log(`  ✓ Caricato: ${key}`);
    } catch (err) {
      console.error(`  ✗ Errore per ${cam.id}: ${err.message}`);
    }
  }

  if (uploadedKeys.length > 0) {
    await updateIndex(uploadedKeys);
  }

  console.log(`\nCompletato: ${uploadedKeys.length}/${WEBCAMS.length} immagini caricate.`);
}

main().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
