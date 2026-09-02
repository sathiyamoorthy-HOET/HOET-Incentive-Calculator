import ResetForm from "./ResetForm";

export const metadata = { title: "Set a new password" };

export default function ResetPage() {
  return (
    <main className="auth">
      <ResetForm />
    </main>
  );
}
