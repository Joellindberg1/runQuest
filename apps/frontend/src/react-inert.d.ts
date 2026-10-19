import 'react';

// React 18:s typer känner inte `inert` (HTML-attributet, baseline sedan 2023). Det skrivs som tom sträng: React 18 skickar okända attribut vidare som de är och tar bort
// attributet när värdet är undefined. Med React 19 blir det ett booleskt attribut och den här filen kan tas bort.
declare module 'react' {
  // Interfacesammanslagning kräver samma typparameter som Reacts egen deklaration, även om den inte används här.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> {
    inert?: '' | undefined;
  }
}
