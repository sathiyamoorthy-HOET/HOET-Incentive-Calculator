import ForgotForm from "./ForgotForm";

export const metadata = { title: "Reset your password" };

export default function ForgotPage() {
  return (
    <main className="auth">
      <ForgotForm />
    </main>
  );
}
