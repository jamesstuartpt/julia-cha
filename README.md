# Baby Shower da Júlia

Site estático (HTML/CSS/JS puro) para a lista de presentes do baby shower. Os amigos escolhem um presente, reservam-no e confirmam a presença. Os dados ficam no Supabase.

## Configurar

1. Cria um projeto em [supabase.com](https://supabase.com) (grátis).
2. No **SQL Editor**, cola o conteúdo de `supabase.sql` e clica em **Run**. Isto cria as tabelas `reservas`, `presencas`, `sugestoes_presentes` e a função `reservar_presente`.
3. Vai a **Project Settings → API** e copia o **Project URL** e a chave **anon / public**.
4. Cola os dois valores em `config.js`:

```js
window.SUPABASE_CONFIG = {
  url: "https://xxxx.supabase.co",
  anonKey: "eyJhbGciOi..."
};
```

5. Faz commit e push. O GitHub Pages publica o site.

> Enquanto `url` e `anonKey` estiverem vazios, o site funciona em pré-visualização: as reservas ficam apenas no dispositivo de quem clica.

## Ver reservas e presenças

No Supabase, **Table Editor**:
- `reservas` — quem reservou cada presente (uma linha por pessoa).
- `presencas` — quem confirmou presença (uma linha por pessoa).
- `sugestoes_presentes` — sugestões de presentes que não estão na lista.

Os nomes nunca aparecem no site público.

## Cancelar uma reserva

No Supabase, **Table Editor → `reservas`**, apaga a linha correspondente ao `presente_id`. O site não permite cancelar pelo browser, para evitar abusos.

## Notas

- Os projetos gratuitos do Supabase **pausam após cerca de uma semana sem atividade**. Entra no painel de vez em quando para o manter ativo.
- Usa sempre a chave **anon / public** no `config.js`. **Nunca** uses a chave `service_role`.
