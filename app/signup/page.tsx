import SignUpForm from "./SignUpForm";

export const metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <main className="auth">
      <SignUpForm />
    </main>
  );
}
