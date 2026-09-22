import { DIGIPEDIA_CAPTION, DIGIPEDIA_PILLARS, DIGIPEDIA_SLOGAN } from "./catalog";

export function HeroSection({
  name,
  stem,
  imageSrc,
}: {
  name: string;
  stem: string;
  imageSrc: string | null;
}) {
  return (
    <section className="pedia-hero" data-pedia-hero="true">
      <div className="pedia-hero__media" aria-hidden>
        {imageSrc ? <img src={imageSrc} alt="" /> : <div className="pedia-hero__fallback" />}
      </div>
      <div className="pedia-hero__shade" aria-hidden />
      <div className="pedia-hero__copy">
        <p className="pedia-hero__name">{stem}OS</p>
        <h1 className="pedia-hero__title">{stem} Digipedia</h1>
        <p className="pedia-hero__slogan">{DIGIPEDIA_SLOGAN}</p>
      </div>
      <ul className="pedia-hero__pillars" aria-label="Knowledge path">
        {DIGIPEDIA_PILLARS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="pedia-hero__sign">
        <p className="pedia-hero__sign-name">{name}</p>
        <p className="pedia-hero__caption">{DIGIPEDIA_CAPTION}</p>
      </div>
    </section>
  );
}
