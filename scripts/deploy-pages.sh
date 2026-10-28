#!/usr/bin/env bash
set -euo pipefail

repo_name="$(basename -s .git "$(git config --get remote.origin.url)")"
export VITE_BASE="/${repo_name}/"

npm run build

deploy_dir="$(mktemp -d)"
cp -R dist/. "${deploy_dir}/"
touch "${deploy_dir}/.nojekyll"

git -C "${deploy_dir}" init
git -C "${deploy_dir}" checkout -b gh-pages
git -C "${deploy_dir}" add .
git -C "${deploy_dir}" commit -m "Deploy GitHub Pages"
git -C "${deploy_dir}" remote add origin "$(git config --get remote.origin.url)"
git -C "${deploy_dir}" push --force origin gh-pages

rm -rf "${deploy_dir}"
