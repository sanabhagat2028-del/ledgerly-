import Link from "next/link";
import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in | Ledgerly" };

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="page">
      <header className="top">
        <Link className="mark" href="/" style={{ textDecoration: "none", color: "inherit" }}>
          Ledgerly<i>.</i>
        </Link>
      </header>
      <section className="login">
        <h1>Open your khata.</h1>
        <p className="lede">
          No password. We email you a link, and it signs you in. New here? The same link creates your account.
        </p>
        <LoginForm linkError={sp.error === "link"} />
      </section>
    </div>
  );
}
