import type { Metadata } from 'next';
import { AuthForm } from '../../components/auth/AuthForm';

export const metadata: Metadata = { title: 'Entrar' };

export default function SignInPage() {
  return <AuthForm />;
}
