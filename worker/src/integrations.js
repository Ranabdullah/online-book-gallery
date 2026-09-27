/**
 * Athenaeum Worker - external service integrations.
 * PDF/EPUB extraction uses Workers-compatible libraries (unpdf, fflate)
 * instead of pdf-parse/epub2, which depend on Node's filesystem and don't
 * run in the Workers runtime.
 */

import { unzipSync, strFromU8 } from 'fflate';
import { getDocumentProxy, extractText } from 'unpdf';

export async function extractPdfText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function extractEpubText(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const htmlFiles = Object.keys(files)
    .filter(name => /\.(xhtml|html|htm)$/i.test(name))
    .sort()
    .slice(0, 15); // first ~15 chapters is plenty for a summary

  let text = '';
  for (const name of htmlFiles) {
    const html = strFromU8(files[name]);
    text += html.replace(/<[^>]+>/g, ' ') + '\n';
    if (text.length > 80000) break;
  }
  return text;
}

export async function callGemini(apiKey, prompt) {
  if (!apiKey) throw new Error('Gemini API key not configured.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const json = await res.json();
  const out = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) throw new Error('Gemini returned no summary: ' + JSON.stringify(json).slice(0, 300));
  return out.trim();
}

// ---------- GitHub Release storage ----------
const RELEASE_TAG = 'library-data';

function ghHeaders(token) {
  return { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

async function getOrCreateRelease(env) {
  const repo = `${env.GITHUB_OWNER}/${env.GITHUB_DATA_REPO}`;
  let res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${RELEASE_TAG}`, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (res.status === 404) {
    res = await fetch(`https://api.github.com/repos/${repo}/releases`, {
      method: 'POST',
      headers: ghHeaders(env.GITHUB_TOKEN),
      body: JSON.stringify({ tag_name: RELEASE_TAG, name: 'Library Data', draft: false, prerelease: false })
    });
  }
  const json = await res.json();
  if (!json.id) throw new Error('Could not create/find GitHub release: ' + JSON.stringify(json).slice(0, 200));
  return json;
}

async function findAsset(env, release, assetName) {
  const repo = `${env.GITHUB_OWNER}/${env.GITHUB_DATA_REPO}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/${release.id}/assets?per_page=100`, { headers: ghHeaders(env.GITHUB_TOKEN) });
  const assets = await res.json();
  return (Array.isArray(assets) ? assets : []).find(a => a.name === assetName);
}

/** Resolves an asset name to a short-lived, real download URL from GitHub's CDN. */
export async function getGithubAssetDownloadUrl(env, assetName) {
  const release = await getOrCreateRelease(env);
  const asset = await findAsset(env, release, assetName);
  if (!asset) throw new Error(`Asset ${assetName} not found in data repo.`);

  const repo = `${env.GITHUB_OWNER}/${env.GITHUB_DATA_REPO}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, {
    headers: { ...ghHeaders(env.GITHUB_TOKEN), Accept: 'application/octet-stream' },
    redirect: 'manual'
  });
  const location = res.headers.get('location');
  if (!location) throw new Error('GitHub did not return a signed download URL.');
  return location;
}

export async function uploadAssetToGithub(env, buffer, assetName, contentType) {
  const release = await getOrCreateRelease(env);
  const existing = await findAsset(env, release, assetName);
  if (existing) return existing;

  const repo = `${env.GITHUB_OWNER}/${env.GITHUB_DATA_REPO}`;
  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { ...ghHeaders(env.GITHUB_TOKEN), 'Content-Type': contentType },
    body: buffer
  });
  return res.json();
}

export async function deleteAssetFromGithub(env, assetName) {
  const release = await getOrCreateRelease(env);
  const asset = await findAsset(env, release, assetName);
  if (!asset) return;
  const repo = `${env.GITHUB_OWNER}/${env.GITHUB_DATA_REPO}`;
  await fetch(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, { method: 'DELETE', headers: ghHeaders(env.GITHUB_TOKEN) });
}

// ---------- VirusTotal ----------
export async function scanBufferForViruses(apiKey, buffer, fileName) {
  if (!apiKey) throw new Error('VirusTotal API key not configured.');

  const form = new FormData();
  form.append('file', new Blob([buffer]), fileName);

  const uploadRes = await fetch('https://www.virustotal.com/api/v3/files', {
    method: 'POST',
    headers: { 'x-apikey': apiKey },
    body: form
  });
  const uploadJson = await uploadRes.json();
  const analysisId = uploadJson?.data?.id;
  if (!analysisId) throw new Error('VirusTotal upload failed: ' + JSON.stringify(uploadJson).slice(0, 200));

  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const check = await fetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, { headers: { 'x-apikey': apiKey } });
    const checkJson = await check.json();
    if (checkJson?.data?.attributes?.status === 'completed') {
      const stats = checkJson.data.attributes.stats;
      return { clean: stats.malicious === 0 && stats.suspicious === 0, stats };
    }
  }
  throw new Error('Virus scan took too long - try again shortly.');
}
