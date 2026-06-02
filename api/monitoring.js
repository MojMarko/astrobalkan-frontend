// Sentry Tunnel - prosledjuje SDK envelope-e ka sentry.io kroz nas domen.
// Razlog: ad blockeri (uBlock, Brave Shield, korporativni firewall, neki antivirusi)
// blokiraju domen sentry.io. Kad SDK salje na nas domen (/api/monitoring), nijedan
// klijentski blocker ne moze da prepozna i blokira. Mi server-side prosledjujemo
// envelope ka pravom Sentry endpoint-u.
// Vise: https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option

const SENTRY_HOST = "o4511444078690304.ingest.de.sentry.io";
// Samo nasi projekti smeju da prolaze - ostalo odbij (sprecava abuse).
const KNOWN_PROJECT_IDS = ["4511472415801424"];

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const envelope = Buffer.concat(chunks).toString("utf8");

    const firstLine = envelope.split("\n", 1)[0];
    const header = JSON.parse(firstLine);
    const dsn = new URL(header.dsn);
    const projectId = dsn.pathname.replace(/^\//, "");

    if (dsn.hostname !== SENTRY_HOST) {
      res.status(400).send("invalid sentry host");
      return;
    }
    if (!KNOWN_PROJECT_IDS.includes(projectId)) {
      res.status(400).send("invalid project id");
      return;
    }

    const upstream = `https://${SENTRY_HOST}/api/${projectId}/envelope/`;
    const r = await fetch(upstream, {
      method: "POST",
      body: envelope,
      headers: { "Content-Type": "application/x-sentry-envelope" }
    });
    const body = await r.text();
    res.status(r.status).send(body);
  } catch (e) {
    res.status(500).send("tunnel error: " + (e && e.message ? e.message : String(e)));
  }
}
