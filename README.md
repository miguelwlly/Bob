# Bob Burguer — projeto completo

Baseado no HTML do Bob Burguer enviado na conversa, com backend Node.js e Mercado Pago Checkout Pro.

## Incluído
- Cardápio e carrinho.
- Backend para pedidos.
- Preços recalculados no servidor.
- Checkout Pro.
- Painel administrativo.
- Mercado Pago configurável pelo painel.
- Access Token criptografado no servidor.
- Token nunca é devolvido completo ao navegador.
- Webhook consulta o pagamento no Mercado Pago antes de atualizar o status.
- Persistência dos pedidos em JSON.
- Páginas de sucesso, pendente e falha.

## Configuração
1. Copie `.env.example` para `.env`.
2. Configure usuário/senha do administrador, `ADMIN_JWT_SECRET` e `PAYMENT_ENCRYPTION_KEY`.
3. Rode `npm install`.
4. Rode `npm start`.
5. Abra `http://localhost:3000`.
6. Entre em **Acesso**.
7. Abra **Mercado Pago**.
8. Escolha TESTE, informe Public Key e Access Token, salve e teste a conexão.

Para produção, o Webhook precisa de URL HTTPS pública.

Não coloque Access Token ou Webhook Secret em HTML, JavaScript público, localStorage ou repositório.
