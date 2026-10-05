import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormNotices } from './FormNotices';
import { TextField } from './TextField';

describe('TextField', () => {
  it('kopplar etiketten till fältet och skickar vidare vanliga input-attribut', () => {
    render(<TextField id="name" label="Name" type="email" placeholder="you@example.com" defaultValue="a@b.se" />);
    const field = screen.getByLabelText('Name');
    expect(field).toHaveAttribute('type', 'email');
    expect(field).toHaveValue('a@b.se');
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(field).not.toHaveAttribute('aria-describedby');
  });

  it('hjälptexten hänger ihop med fältet via aria-describedby', () => {
    render(<TextField id="pw" label="Password" hint="At least 6 characters" />);
    const field = screen.getByLabelText('Password');
    expect(field).toHaveAccessibleDescription('At least 6 characters');
  });

  it('felet ersätter hjälptexten, markerar fältet ogiltigt och blir dess beskrivning', () => {
    render(<TextField id="pw" label="Password" hint="At least 6 characters" error="Passwords do not match" />);
    const field = screen.getByLabelText('Password');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Passwords do not match');
    expect(screen.queryByText('At least 6 characters')).not.toBeInTheDocument();
  });

  it('invalid + aria-describedby: felet visas på annat håll men fältet pekar på det', () => {
    render(
      <>
        <TextField id="user" label="Username" invalid aria-describedby="elsewhere" hint="Your handle" />
        <p id="elsewhere">Invalid credentials</p>
      </>,
    );
    const field = screen.getByLabelText('Username');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Invalid credentials Your handle');
  });

  it('hideLabel döljer etiketten i bild men behåller den för skärmläsare', () => {
    render(<TextField id="n" label="Days" hideLabel />);
    expect(screen.getByLabelText('Days')).toBeInTheDocument();
    expect(screen.getByText('Days')).toHaveClass('sr-only');
  });

  it('vidarebefordrar ref till input-elementet (fokus vid fel)', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField id="n" label="Name" ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText('Name'));
  });
});

describe('FormNotices', () => {
  it('behållarna finns permanent, även utan text (annars annonseras inte live-regionerna pålitligt)', () => {
    render(<FormNotices />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('bekräftelsen hamnar i status och felet i alert', () => {
    render(<FormNotices status="Saved" error="Could not reach the server" />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server');
  });

  it('samma behållare får text i efterhand (regionen byts inte ut)', () => {
    const { rerender } = render(<FormNotices />);
    const alert = screen.getByRole('alert');
    rerender(<FormNotices error="Nope" />);
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert).toHaveTextContent('Nope');
  });

  it('name ger regionerna egna namn när flera formulär delar en sida', () => {
    render(<FormNotices name="Password" />);
    expect(screen.getByRole('status', { name: 'Password status' })).toBeInTheDocument();
    expect(screen.getByRole('alert', { name: 'Password error' })).toBeInTheDocument();
  });
});
