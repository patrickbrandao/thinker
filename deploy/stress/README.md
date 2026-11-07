# Ambiente de stress: Thinker + White Wizard

Arquivos do ambiente de stress descrito nos tutoriais [#1](../../docs/tutoriais/thinker-with-white-wizard-01.md) (só OpenAI) e [#2](../../docs/tutoriais/thinker-with-white-wizard-02.md) (todos os provedores, 12 harnesses e loop sem fim). A pasta `opt/` espelha o `/opt` do servidor: cada subpasta vai para o caminho de mesmo nome.

Nenhum segredo está aqui. Cada pasta com credenciais tem um `.env.example`; o `.env` de verdade nasce no servidor, com `chmod 600`, pelos comandos dos tutoriais.

| Pasta | Tutorial | O que é |
| --- | --- | --- |
| `opt/wwz-openai/` | #1, seção 3 | White Wizard só OpenAI: API, Valkey e painel (`wwz.yaml` é renderizado com `envsubst` em `run/`) |
| `opt/thinker/` | #1, seção 4; #2, seção 7 | Thinker para stress (`thinker-app` + `thinker-postgres`) e `escala.sh` (réplicas no alias `thinker-pool`) |
| `opt/thinker-stress/` | #1, seção 6 | `stress.sh`: base, conc, rps, rampa, sweep, agentes, traefik, falhas, top |
| `opt/wwz-todos/` | #2, seção 3 | Quatro instâncias do wwz com os seis drivers (perfeito, falhas, lento, instável), Valkey e painel |
| `opt/thinker-stress-02/` | #2, seções 6 e 8 | `provisionar.sh` (24 conexões, 12 harnesses, cascata de fallback), `loop.sh` (geradores eternos) e `stress.sh` (dispara e para) |

## Instalar num servidor

Pré-requisitos e explicações estão nos tutoriais. O caminho curto:

```bash
# copiar para o servidor (os .env.example vao junto; os .env nao existem aqui)
rsync -av deploy/stress/opt/ root@servidor:/opt/

# no servidor: gerar os .env (tutorial #1 secoes 3.1, 4.1 e 5.5; tutorial #2 secoes 2 e 6),
# renderizar os YAML do wwz em run/ e subir cada compose
cd /opt/wwz-openai && docker compose up -d --wait
cd /opt/thinker && docker compose up -d --wait
cd /opt/wwz-todos && docker compose up -d --wait
/opt/thinker-stress-02/provisionar.sh
```

## Disparar o stress

```bash
/opt/thinker-stress/stress.sh conc 100              # tutorial #1, uma rodada medida
/opt/thinker-stress-02/stress.sh iniciar            # tutorial #2, com freios: 3 replicas, 10 degraus, limites do compose
/opt/thinker-stress-02/stress.sh iniciar --sem-freios   # secao 8.3: sem limites, pede confirmacao
/opt/thinker-stress-02/stress.sh status
/opt/thinker-stress-02/stress.sh parar
```

O modo `--sem-freios` copia `sem-freios.override.yml` para `/opt/thinker/docker-compose.override.yml`, o que tira os limites de CPU e memória do Thinker e liga o fsync do Postgres. Não use num servidor com outros serviços de produção: o loop foi feito para esgotar CPU, memória e disco. O `parar` remove o override, volta a uma réplica e restaura os limites.

Versão mínima do Thinker: **0.31.6** (os bugs que esse ambiente expôs estão na seção 10 do tutorial #2).
