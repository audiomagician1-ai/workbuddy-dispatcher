/**
 * feature_manager.js - Feature 管理（参考 agent-swarm 的 FeatureSelector）
 *
 * 管理 feature 清单，支持选择、锁定、完成、失败等操作。
 */
const fs = require('fs');
const path = require('path');

class FeatureManager {
  constructor() {
    this.features = [];
    this.filePath = null;
    this._locked = new Set();
  }

  loadFromJSON(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    // Support both flat array and { features: [...] } format
    if (Array.isArray(data)) {
      this.features = data;
    } else if (data.features) {
      this.features = data.features;
    } else {
      throw new Error('Invalid feature list format');
    }

    this.filePath = filePath;
    // Ensure all features have required fields
    this.features = this.features.map(f => ({
      id: f.id,
      title: f.title || f.description || '',
      description: f.description || f.title || '',
      category: f.category || 'default',
      priority: f.priority ?? 999,
      group: f.group || null,
      depends_on: f.depends_on || [],
      status: f.status || 'todo', // todo | in_progress | done | failed
      locked_by: f.locked_by || null,
      acceptance_criteria: f.acceptance_criteria || [],
      test_commands: f.test_commands || [],
      notes: f.notes || ''
    }));

    return this.getStats();
  }

  getNext(preferGroup = true) {
    const available = this.features.filter(f =>
      f.status === 'todo' &&
      !this._locked.has(f.id) &&
      this._depsSatisfied(f)
    );

    if (available.length === 0) return null;

    // Sort by priority
    available.sort((a, b) => a.priority - b.priority);

    if (preferGroup) {
      // Group features: find groups with >= 3 available
      const groups = new Map();
      for (const f of available) {
        if (f.group) {
          if (!groups.has(f.group)) groups.set(f.group, []);
          groups.get(f.group).push(f);
        }
      }
      // Return first group with enough features (topologically sorted, max 8)
      for (const [, members] of groups) {
        if (members.length >= 3) {
          return members.slice(0, 8);
        }
      }
    }

    // Return single top-priority feature
    return [available[0]];
  }

  markInProgress(featureIds) {
    const ids = Array.isArray(featureIds) ? featureIds : [featureIds];
    for (const id of ids) {
      const f = this.features.find(x => x.id === id);
      if (f) {
        f.status = 'in_progress';
        this._locked.add(id);
      }
    }
    return this.getStats();
  }

  markCompleted(featureIds) {
    const ids = Array.isArray(featureIds) ? featureIds : [featureIds];
    for (const id of ids) {
      const f = this.features.find(x => x.id === id);
      if (f) {
        f.status = 'done';
        f.locked_by = null;
        this._locked.delete(id);
      }
    }
    this._save();
    return this.getStats();
  }

  markFailed(featureIds, reason = '') {
    const ids = Array.isArray(featureIds) ? featureIds : [featureIds];
    for (const id of ids) {
      const f = this.features.find(x => x.id === id);
      if (f) {
        f.status = 'failed';
        f.notes = reason ? `${f.notes} [FAILED: ${reason}]`.trim() : f.notes;
        f.locked_by = null;
        this._locked.delete(id);
      }
    }
    this._save();
    return this.getStats();
  }

  getStats() {
    const total = this.features.length;
    const done = this.features.filter(f => f.status === 'done').length;
    const failed = this.features.filter(f => f.status === 'failed').length;
    const inProgress = this.features.filter(f => f.status === 'in_progress').length;
    const available = this.features.filter(f =>
      f.status === 'todo' && !this._locked.has(f.id) && this._depsSatisfied(f)
    ).length;
    return { total, done, failed, inProgress, available, passRate: total > 0 ? Math.round(done / total * 100) : 0 };
  }

  allDone() {
    return this.features.every(f => f.status === 'done');
  }

  getFeature(id) {
    return this.features.find(f => f.id === id) || null;
  }

  listFeatures(status = null) {
    if (status) return this.features.filter(f => f.status === status);
    return [...this.features];
  }

  _depsSatisfied(feature) {
    if (!feature.depends_on || feature.depends_on.length === 0) return true;
    return feature.depends_on.every(depId => {
      const dep = this.features.find(f => f.id === depId);
      return dep && dep.status === 'done';
    });
  }

  _save() {
    if (this.filePath && fs.existsSync(this.filePath)) {
      const data = this.features;
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
  }
}

module.exports = { FeatureManager };
