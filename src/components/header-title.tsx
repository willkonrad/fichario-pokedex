import { HeaderTitle } from 'expo-router/react-navigation';
import type { ComponentProps } from 'react';

import { digitsInSystemFont } from '@/components/digits';
import { font } from '@/theme';

/** Kanit 20: o título da barra do topo das telas. */
export const HEADER_TITLE_STYLE = { fontFamily: font.display, fontWeight: 'normal', fontSize: 20 } as const;

type TitleProps = ComponentProps<typeof HeaderTitle> & { children: string };

/** Título da barra do topo: `headerTitle` padrão do _layout, com os números na fonte do sistema. */
export function renderHeaderTitle({ children, ...rest }: TitleProps) {
  return (
    <HeaderTitle {...rest} style={HEADER_TITLE_STYLE}>
      {/* O tipo do HeaderTitle só prevê texto, mas ele desenha um Text: os trechos aninhados funcionam. */}
      {digitsInSystemFont(children) as string}
    </HeaderTitle>
  );
}

/** Para a tela cujo título na barra difere do `title` (o da aba, na web): `headerTitle: headerTitleFor('Colocar carta')`. */
export function headerTitleFor(text: string) {
  return (props: TitleProps) => renderHeaderTitle({ ...props, children: text });
}
