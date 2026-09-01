import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in · HOET Incentive" };

export default function LoginPage() {
  return (
    <main className="auth">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
