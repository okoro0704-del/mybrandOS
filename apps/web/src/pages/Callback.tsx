import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useIdentity } from "../state/identity-store";

export function CallbackPage() {
  const [params] = useSearchParams();
  const { completeTrustId } = useIdentity();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setError("Missing Trust ID callback parameters.");
      return;
    }
    completeTrustId(code, state)
      .then(() => navigate("/", { replace: true }))
      .catch((err: Error) => setError(err.message));
  }, [completeTrustId, navigate, params]);

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="eyebrow">Trust ID</div>
        <h1>{error ? "Sign-in failed" : "Connecting identity"}</h1>
        <p>{error || "Exchanging a Trust ID authorization code."}</p>
      </div>
    </div>
  );
}
