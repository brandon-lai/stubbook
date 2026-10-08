import Link from "next/link";
import Home from "@/components/Home";
import DemoBoard from "@/components/DemoBoard";
import Logo from "@/components/Logo";
import demo from "@/public/samples/demo.json";

export default function Page() {
  const intro = (
    <main className="wrap">
      <section className="hero">
        <span className="kicker">Your tickets, kept</span>
        <h1>Every boarding pass, train ticket and concert stub, on one page.</h1>
        <p>Scan a paper ticket with your phone or upload a pass. It comes out as a cut-out with its barcode and booking codes blurred, and lands on a collage you can arrange, keep and share.</p>
        <div className="row">
          <Link className="btn primary" href="/scan" data-testid="start">Scan your first ticket</Link>
          <Link className="btn" href="/scan">Upload a pass or PDF</Link>
        </div>
      </section>
      <div style={{ margin: "26px 0 8px" }}>
        <DemoBoard tickets={demo.tickets as never} placements={demo.placements} />
        <p className="small muted" style={{ marginTop: 8 }}>A sample collage. Tap a ticket to see its back. Codes and booking references are blurred the way yours will be.</p>
      </div>
      <section className="steps">
        <div className="card"><span className="kicker">1 · Scan</span><h3>Point, hold, done</h3><p className="muted small">The scanner finds the ticket&apos;s edges, flattens it and cuts it out. Creased or curled? Drag the corners.</p></div>
        <div className="card"><span className="kicker">2 · Read</span><h3>Details filled in</h3><p className="muted small">Route, date, carrier and seat from the barcode or the print. Fix anything; a ticket saves even if nothing reads.</p></div>
        <div className="card"><span className="kicker">3 · Private</span><h3>Blurred by default</h3><p className="muted small">Barcodes, booking references, ticket and frequent flyer numbers are blurred. Photos stay on your device.</p></div>
        <div className="card"><span className="kicker">4 · Share</span><h3>One link, when you want</h3><p className="muted small">Collages are private until you share one. A shared link is read-only and only ever shows blurred tickets.</p></div>
      </section>
    </main>
  );
  return (
    <>
      <header className="topbar"><div className="wrap">
        <Link href="/" className="brand"><Logo /></Link>
        <span className="spacer" />
        <Link className="btn small" href="/scan">Scan</Link>
      </div></header>
      <Home intro={intro} />
      <footer className="footer wrap">Stubbook keeps your collages on this device. Tickets are keepsakes, not valid for travel or entry.</footer>
    </>
  );
}
