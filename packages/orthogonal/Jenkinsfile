#!/usr/bin/env groovy

ansiColor('xterm') {
  node('executor') {
    checkout scm

    // ── Path filter ────────────────────────────────────────────────────
    def changes = sh(
            script: "git diff --name-only HEAD~1 HEAD || true",
            returnStdout: true
    ).trim()

    if (!changes.contains('packages/orthogonal/')) {
      echo "No changes under packages/orthogonal/. Skipping build."
      currentBuild.result = 'NOT_BUILT'
      currentBuild.description = 'No orthogonal changes'
      return
    }

    def commitHash = sh(
            script: "git rev-parse --short HEAD",
            returnStdout: true
    ).trim()

    currentBuild.description = "commit: ${commitHash}"

    // ── Build ──────────────────────────────────────────────────────────
    stage('Install') {
      sh """#!/bin/bash -ex
            . $HOME/.nvm/nvm.sh ; nvm use 18.17.1
            npm install -g pnpm
            pnpm install
      """
    }

    stage('Build Embed') {
      sh "pnpm build:orthogonal-embed"
      stash includes: "packages/orthogonal/dist-embed/**", name: 'dist-embed'
    }
  }
}