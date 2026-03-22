use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

#[derive(Debug, Clone)]
pub struct ProjectPaths {
    pub root_dir: PathBuf,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub runs_dir: PathBuf,
    pub snapshots_dir: PathBuf,
    pub sources_dir: PathBuf,
    pub exports_dir: PathBuf,
}

impl ProjectPaths {
    pub fn for_root(root_dir: PathBuf) -> Self {
        let data_dir = root_dir.join(".nodex");
        Self {
            db_path: data_dir.join("project.db"),
            runs_dir: data_dir.join("runs"),
            snapshots_dir: data_dir.join("snapshots"),
            sources_dir: data_dir.join("sources"),
            exports_dir: data_dir.join("exports"),
            root_dir,
            data_dir,
        }
    }

    pub fn discover_from(start: &Path) -> Result<Self> {
        let mut current = start
            .canonicalize()
            .with_context(|| format!("failed to resolve workspace path {}", start.display()))?;

        loop {
            let candidate = Self::for_root(current.clone());
            if candidate.db_path.exists() {
                return Ok(candidate);
            }

            if !current.pop() {
                bail!(
                    "no Nodex workspace found above {}; run `nodex init` first",
                    start.display()
                );
            }
        }
    }

    pub fn create_layout(&self) -> Result<()> {
        std::fs::create_dir_all(&self.data_dir)
            .with_context(|| format!("failed to create {}", self.data_dir.display()))?;
        std::fs::create_dir_all(&self.runs_dir)
            .with_context(|| format!("failed to create {}", self.runs_dir.display()))?;
        std::fs::create_dir_all(&self.snapshots_dir)
            .with_context(|| format!("failed to create {}", self.snapshots_dir.display()))?;
        std::fs::create_dir_all(&self.sources_dir)
            .with_context(|| format!("failed to create {}", self.sources_dir.display()))?;
        std::fs::create_dir_all(&self.exports_dir)
            .with_context(|| format!("failed to create {}", self.exports_dir.display()))?;
        Ok(())
    }
}
