import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { LoginForm } from '@/components/auth/login-form';

const { ensureMock, requestMock } = vi.hoisted(() => ({
  ensureMock: vi.fn(),
  requestMock: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  ensureAccessToken: ensureMock,
  requestPasswordToken: requestMock,
}));

describe('LoginForm', () => {
  beforeEach(() => {
    ensureMock.mockReset();
    requestMock.mockReset();
    // No silent-refresh session by default → the password form renders.
    ensureMock.mockResolvedValue(null);
  });

  it('signs in via the password grant and calls onAuthenticated', async () => {
    requestMock.mockResolvedValue(undefined);
    const onAuthenticated = vi.fn();
    render(<LoginForm onAuthenticated={onAuthenticated} />);

    const email = await screen.findByLabelText('Email');
    fireEvent.change(email, { target: { value: 'ada@fps4.nl' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith({ username: 'ada@fps4.nl', password: 'pw' }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
  });

  it('shows a generic error and does not authenticate when the grant is rejected', async () => {
    requestMock.mockRejectedValue(new Error('401'));
    const onAuthenticated = vi.fn();
    render(<LoginForm onAuthenticated={onAuthenticated} />);

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'ada@fps4.nl' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign-in failed/i);
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});
