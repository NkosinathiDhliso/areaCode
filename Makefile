.PHONY: build-fn deploy-fn build-all deploy-all

FN ?=
ENV ?= dev

LAMBDA_LIST := $(shell cat infra/lambda_list.txt)

build-fn:
	@test -n "$(FN)" || (echo "Usage: make build-fn FN=check-in" && exit 1)
	@echo "Building $(FN)..."
	@mkdir -p dist/$(FN)
	npx esbuild backend/src/features/$(FN)/handler.ts \
		--bundle --platform=node --target=node20 \
		--outfile=dist/$(FN)/index.js --format=esm \
		--external:@prisma/client --external:prisma
	@cp -r backend/prisma/migrations dist/$(FN)/ 2>/dev/null || true
	@(cd dist/$(FN) && zip -r ../../dist/$(FN).zip .)
	@echo "Built dist/$(FN).zip"

deploy-fn:
	@test -n "$(FN)" || (echo "Usage: make deploy-fn FN=check-in ENV=dev" && exit 1)
	@echo "Deploying $(FN) to $(ENV)..."
	@if aws lambda get-function --function-name area-code-$(ENV)-$(FN) --query 'Code.Location' --output text > /dev/null 2>&1; then \
		echo "Saving previous version as rollback..."; \
		aws lambda get-function --function-name area-code-$(ENV)-$(FN) --query 'Code.Location' --output text | xargs -I{} curl -s -o dist/$(FN)-previous.zip "{}"; \
	fi
	aws lambda update-function-code \
		--function-name area-code-$(ENV)-$(FN) \
		--zip-file fileb://dist/$(FN).zip \
		--architectures arm64
	@echo "Deployed area-code-$(ENV)-$(FN)"

build-all:
	@echo "Building all Lambda functions..."
	@for fn in $(LAMBDA_LIST); do \
		$(MAKE) build-fn FN=$$fn || exit 1; \
	done
	@echo "All functions built."

deploy-all:
	@echo "Deploying all Lambda functions to $(ENV)..."
	@for fn in $(LAMBDA_LIST); do \
		$(MAKE) deploy-fn FN=$$fn ENV=$(ENV) || exit 1; \
	done
	@echo "All functions deployed to $(ENV)."

rollback-fn:
	@test -n "$(FN)" || (echo "Usage: make rollback-fn FN=check-in ENV=dev" && exit 1)
	@test -f dist/$(FN)-previous.zip || (echo "No previous.zip found for $(FN)" && exit 1)
	@echo "Rolling back $(FN) on $(ENV)..."
	aws lambda update-function-code \
		--function-name area-code-$(ENV)-$(FN) \
		--zip-file fileb://dist/$(FN)-previous.zip \
		--architectures arm64
	@echo "Rolled back area-code-$(ENV)-$(FN)"
