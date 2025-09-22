import { signInWithCustomToken, signOut } from "firebase/auth";
import type { Role } from "../types";
import { auth, ensureFirebaseUser } from "./firebaseConfig";

interface PinAuthResponse {
  token: string;
  role: Role;
}

const resolvePinAuthEndpoint = (): string => {
  const explicitEndpoint = import.meta.env.VITE_PIN_AUTH_ENDPOINT as string | undefined;
  if (explicitEndpoint && explicitEndpoint.trim() !== "") {
    return explicitEndpoint;
  }

  const projectId = import.meta.env.VITE_PROJECT_ID as string | undefined;
  const region = (import.meta.env.VITE_FUNCTIONS_REGION as string | undefined) || "us-central1";

  if (import.meta.env.DEV) {
    const emulatorPort = import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT as string | undefined;
    if (emulatorPort && projectId) {
      return `http://localhost:${emulatorPort}/${projectId}/${region}/verifyPinAndIssueToken`;
    }
  }

  if (projectId) {
    return `https://${region}-${projectId}.cloudfunctions.net/verifyPinAndIssueToken`;
  }

  throw new Error("Aucun endpoint pour l'échange du PIN n'est configuré");
};

export const exchangePinForFirebaseToken = async (pin: string): Promise<PinAuthResponse> => {
  const endpoint = resolvePinAuthEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pin }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || "Impossible de valider le PIN fourni");
  }

  const payload = await response.json() as Partial<PinAuthResponse>;
  if (!payload?.token || !payload?.role) {
    throw new Error("Réponse invalide du service d'authentification");
  }

  return payload as PinAuthResponse;
};

export const loginWithPin = async (pin: string): Promise<Role | null> => {
  if (!pin) {
    return null;
  }

  const { token, role } = await exchangePinForFirebaseToken(pin);
  await signInWithCustomToken(auth, token);
  return role;
};

export const logoutFromFirebase = async (): Promise<void> => {
  await signOut(auth);
  await ensureFirebaseUser();
};
