# HedgeDoc 1.10.3 menmen custom — multi-stage (Node 20 + Yarn Berry)
FROM node:20-alpine AS builder
ARG APK_MIRROR=mirrors.tuna.tsinghua.edu.cn
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG YARN_BIN=.yarn/releases/yarn-4.9.0.cjs
RUN sed -i "s/dl-cdn.alpinelinux.org/${APK_MIRROR}/g" /etc/apk/repositories \
    && apk add --no-cache python3 make g++ git
WORKDIR /hedgedoc
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN printf '\nnpmRegistryServer: "%s"\nhttpTimeout: 600000\n' "${NPM_REGISTRY}" >> .yarnrc.yml \
    && node ${YARN_BIN} install --immutable
COPY . .
RUN node ${YARN_BIN} build

FROM node:20-alpine
RUN apk add --no-cache tini wget \
    && addgroup -S hedgedoc && adduser -S -G hedgedoc hedgedoc
WORKDIR /hedgedoc
COPY --from=builder --chown=hedgedoc:hedgedoc /hedgedoc/app.js ./
COPY --from=builder --chown=hedgedoc:hedgedoc /hedgedoc/lib ./lib
COPY --from=builder --chown=hedgedoc:hedgedoc /hedgedoc/public ./public
COPY --from=builder --chown=hedgedoc:hedgedoc /hedgedoc/locales ./locales
COPY --from=builder --chown=hedgedoc:hedgedoc /hedgedoc/node_modules ./node_modules
COPY --from=builder --chown=hedgedoc:hedgedoc /hedgedoc/package.json /hedgedoc/yarn.lock ./
ENV NODE_ENV=production
USER hedgedoc
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q --spider http://127.0.0.1:3000/status || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["node", "app.js"]
