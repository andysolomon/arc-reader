import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input } from "@readaloud/ui";
import { useSettings } from "../state/settings";
import { toast } from "../state/toast";
import { API_BASE, usesBuiltInProxy } from "../engine/providers";

export function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(useSettings.getState().email ?? "");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (usesBuiltInProxy()) {
        const r = await fetch(`${API_BASE}/auth/magic-link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }
      setSent(true);
    } catch {
      toast("Couldn't reach the sign-in service");
    } finally {
      setBusy(false);
    }
  };

  const google = () => {
    if (usesBuiltInProxy()) {
      location.assign(`${API_BASE}/auth/google?redirect=${encodeURIComponent(location.origin)}`);
      return;
    }
    toast("Google sign-in needs the cloud API");
  };

  return (
    <section data-screen="auth" className="grid flex-1 place-items-center overflow-y-auto p-6 animate-fadein">
      <div className="flex w-full max-w-[380px] flex-col gap-7">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-serif text-[28px] font-medium tracking-[-.01em]">ReadAloud</h1>
          <div className="text-[15px] text-fg2">Sign in. No passwords, no onboarding.</div>
        </div>
        {!sent ? (
          <>
            <form onSubmit={send} className="flex flex-col gap-2.5">
              <Input type="email" required placeholder="you@example.com" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-[46px] text-[15px]" autoComplete="email" />
              <Button type="submit" variant="primary" size="lg" loading={busy} className="font-semibold">
                Send magic link
              </Button>
            </form>
            <div className="flex items-center gap-3 text-[12px] text-fg2" aria-hidden>
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
            <Button size="lg" onClick={google} leading={<span className="grid size-5 place-items-center rounded-full border-[1.5px] border-fg text-[12px] font-bold text-fg" aria-hidden>G</span>}>
              Continue with Google
            </Button>
          </>
        ) : (
          <div className="flex flex-col gap-1.5 rounded-panel border border-line bg-bg2 p-[18px] animate-rise" role="status">
            <div className="text-[15px] font-semibold">Check your inbox</div>
            <div className="text-fg2">
              We sent a sign-in link to {email}. It expires in 15 minutes.
            </div>
            {!usesBuiltInProxy() && (
              <button
                type="button"
                onClick={() => {
                  useSettings.getState().set("email", email);
                  navigate("/");
                  toast("Signed in (local demo)");
                }}
                className="mt-2 self-start border-0 bg-transparent p-0 text-accent hover:text-fg"
              >
                Open the app (no API configured)
              </button>
            )}
          </div>
        )}
        <Button variant="link" onClick={() => navigate("/")} className="self-center text-[13px]">
          Continue without an account
        </Button>
      </div>
    </section>
  );
}
