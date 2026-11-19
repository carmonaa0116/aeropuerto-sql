import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Repo público: los enlaces relativos del README (app/README.md, docs/...) apuntan a GitHub. */
export const REPO_GITHUB = 'https://github.com/carmonaa0116/aeropuerto-sql';

function resolver(href: string, base: string): string {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const ruta = new URL(href, `https://x/${base}`).pathname.slice(1);
  return `${REPO_GITHUB}/blob/HEAD/${ruta}`;
}

/**
 * Pinta markdown del repo (README.md, docs/*.md) con tablas GFM.
 * react-markdown no interpreta HTML incrustado: no hay riesgo de inyectar marcado.
 * `base` = carpeta del archivo dentro del repo ("" para el README, "docs/" para docs).
 */
export function Markdown({ md, base = '' }: { md: string; base?: string }) {
  const componentes: Components = {
    a: ({ href = '', children }) => {
      const url = resolver(href, base);
      const externo = /^https?:/.test(url);
      return (
        <a href={url} {...(externo ? { target: '_blank', rel: 'noreferrer' } : {})}>
          {children}
        </a>
      );
    },
    table: ({ children }) => (
      <div className="tabla-envoltura md-tabla">
        <table className="datos">{children}</table>
      </div>
    ),
  };
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={componentes}>
        {md}
      </ReactMarkdown>
    </div>
  );
}
