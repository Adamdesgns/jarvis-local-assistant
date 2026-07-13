(function () {
  class JarvisHologram {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.state = 'ready';
      this.audioLevel = 0;
      this.targetAudio = 0;
      this.explosion = 0;
      this.explosionTarget = 0;
      this.seed = 4107;
      this.particles = [];
      this.orbitNodes = [];
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement);
      this.resize();
      this.createGeometry();
      requestAnimationFrame((time) => this.draw(time));
    }

    random() {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      return this.seed / 4294967296;
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.canvas.width = Math.round(this.width * ratio);
      this.canvas.height = Math.round(this.height * ratio);
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      this.cx = this.width / 2;
      this.cy = this.height / 2;
      this.radius = Math.min(this.width * 0.34, this.height * 0.44, 335);
    }

    createGeometry() {
      this.particles = Array.from({ length: 320 }, () => {
        const u = this.random();
        const v = this.random();
        return {
          theta: Math.PI * 2 * u,
          phi: Math.acos(2 * v - 1),
          shell: 0.68 + this.random() * 0.42,
          size: 0.35 + this.random() * 1.35,
          drift: (this.random() - 0.5) * 0.00016,
          phase: this.random() * Math.PI * 2,
          bright: this.random() > 0.86
        };
      });
      this.orbitNodes = Array.from({ length: 34 }, () => ({
        angle: this.random() * Math.PI * 2,
        radius: 0.54 + this.random() * 0.58,
        tilt: (this.random() - .5) * .95,
        speed: .00005 + this.random() * .00019,
        phase: this.random() * Math.PI * 2,
        size: this.random() > .8 ? 2.1 : 1
      }));
    }

    setState(state) {
      this.state = state || 'ready';
      this.explosionTarget = state === 'exploding' ? 1 : 0;
    }

    setAudioLevel(level) {
      this.targetAudio = Math.max(0, Math.min(1, Number(level) || 0));
    }

    ring(ctx, radius, squash, rotation, phase, alpha, width = 1, dash = []) {
      ctx.save();
      ctx.translate(this.cx, this.cy);
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.lineDashOffset = -phase;
      ctx.ellipse(0, 0, radius, radius * squash, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 176, 28, ${alpha})`;
      ctx.lineWidth = width;
      ctx.shadowColor = 'rgba(255, 153, 0, .72)';
      ctx.shadowBlur = alpha > .25 ? 8 : 3;
      ctx.stroke();
      ctx.restore();
    }

    arcRing(ctx, radius, squash, rotation, start, length, alpha, width = 1) {
      ctx.save();
      ctx.translate(this.cx, this.cy);
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * squash, 0, start, start + length);
      ctx.strokeStyle = `rgba(255, 190, 54, ${alpha})`;
      ctx.lineWidth = width;
      ctx.shadowColor = '#ff9e00';
      ctx.shadowBlur = 9;
      ctx.stroke();
      ctx.restore();
    }

    drawSphereGrid(ctx, time, intensity) {
      const spin = time * .000055;
      for (let i = -3; i <= 3; i += 1) {
        const ratio = i / 4;
        const localRadius = this.radius * Math.sqrt(1 - ratio * ratio);
        this.ring(ctx, localRadius, .24, -.07, spin * 120 + i * 8, .075 * intensity, .65, [3, 11]);
        ctx.save();
        ctx.translate(0, ratio * this.radius * .86);
        this.ring(ctx, localRadius, .19, .03, -spin * 90 + i * 7, .06 * intensity, .55, [2, 9]);
        ctx.restore();
      }
      for (let i = 0; i < 7; i += 1) {
        this.ring(ctx, this.radius, .3, spin + (i * Math.PI / 7), time * .01, .075 * intensity, .6, [2, 13]);
      }
    }

    drawParticles(ctx, time, intensity) {
      const rotY = time * .000075;
      const rotX = .32 + Math.sin(time * .00019) * .06;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      for (const particle of this.particles) {
        particle.theta += particle.drift;
        const burst = 1 + this.explosion * (2.4 + particle.shell * 1.6);
        const radius = this.radius * particle.shell * (1 + this.audioLevel * .045) * burst;
        let x = radius * Math.sin(particle.phi) * Math.cos(particle.theta);
        let y = radius * Math.cos(particle.phi);
        let z = radius * Math.sin(particle.phi) * Math.sin(particle.theta);
        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;
        const y1 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        const perspective = 1 + z2 / (this.radius * 4.5);
        const px = this.cx + x1 * perspective;
        const py = this.cy + y1 * perspective;
        const twinkle = .52 + Math.sin(time * .0017 + particle.phase) * .28;
        const alpha = Math.max(.03, (z2 / (this.radius * burst) + 1.35) * .26 * twinkle * intensity * (1 - this.explosion * .35));
        ctx.beginPath();
        ctx.arc(px, py, particle.size * perspective * (particle.bright ? 1.35 : 1), 0, Math.PI * 2);
        ctx.fillStyle = particle.bright
          ? `rgba(255, 231, 162, ${Math.min(.95, alpha * 1.8)})`
          : `rgba(255, 165, 12, ${alpha})`;
        if (particle.bright) {
          ctx.shadowColor = '#ffb31f';
          ctx.shadowBlur = 6;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    drawNodes(ctx, time, intensity) {
      const points = [];
      for (const node of this.orbitNodes) {
        const angle = node.angle + time * node.speed;
        const r = this.radius * node.radius;
        const x = this.cx + Math.cos(angle) * r;
        const y = this.cy + Math.sin(angle) * r * (.35 + Math.abs(node.tilt) * .22) + Math.sin(angle * 2 + node.phase) * 10;
        points.push({ x, y, node });
        ctx.beginPath();
        ctx.arc(x, y, node.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 201, 88, ${.42 * intensity})`;
        ctx.shadowColor = '#ff9e00';
        ctx.shadowBlur = 7;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      for (let i = 0; i < points.length; i += 4) {
        const a = points[i];
        const b = points[(i + 7) % points.length];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(255, 165, 15, ${.045 * intensity})`;
        ctx.lineWidth = .5;
        ctx.stroke();
      }
    }

    drawCore(ctx, time, intensity) {
      const active = this.state === 'listening' ? 1.34 : this.state === 'processing' ? 1.17 : this.state === 'speaking' ? 1.23 : 1;
      const pulse = 1 + Math.sin(time * .003) * .035 + this.audioLevel * .1;
      const core = this.radius * .18 * pulse * active;
      const glow = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, core * 2.8);
      glow.addColorStop(0, `rgba(255, 243, 199, ${.82 * intensity})`);
      glow.addColorStop(.14, `rgba(255, 181, 35, ${.52 * intensity})`);
      glow.addColorStop(.42, `rgba(255, 133, 0, ${.17 * intensity})`);
      glow.addColorStop(1, 'rgba(255, 120, 0, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, core * 2.8, 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < 4; i += 1) {
        this.ring(ctx, core * (1 + i * .45), .95 - i * .07, time * (i % 2 ? -.00024 : .00019), time * .035, (.55 - i * .09) * intensity, i === 0 ? 1.5 : .8, i % 2 ? [4, 5] : [11, 4]);
      }

      ctx.save();
      ctx.translate(this.cx, this.cy);
      ctx.rotate(time * -.00017);
      for (let i = 0; i < 12; i += 1) {
        ctx.rotate(Math.PI / 6);
        ctx.beginPath();
        ctx.moveTo(core * 1.2, 0);
        ctx.lineTo(core * 1.82, 0);
        ctx.strokeStyle = `rgba(255, 201, 93, ${.42 * intensity})`;
        ctx.lineWidth = i % 3 === 0 ? 1.4 : .5;
        ctx.stroke();
      }
      ctx.restore();
    }

    draw(time) {
      this.audioLevel += (this.targetAudio - this.audioLevel) * .16;
      this.explosion += (this.explosionTarget - this.explosion) * .11;
      this.ctx.clearRect(0, 0, this.width, this.height);
      const ctx = this.ctx;
      const intensity = this.state === 'ready' ? .82 : 1.12;

      const backdrop = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.radius * 1.7);
      backdrop.addColorStop(0, 'rgba(255, 151, 0, .055)');
      backdrop.addColorStop(.42, 'rgba(255, 126, 0, .025)');
      backdrop.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, this.width, this.height);

      this.ring(ctx, this.radius * 1.23, .98, time * .000025, time * .012, .15 * intensity, .7, [2, 12]);
      this.ring(ctx, this.radius * 1.13, .36, -.18, -time * .018, .24 * intensity, 1, [18, 7, 2, 8]);
      this.ring(ctx, this.radius * 1.05, .62, .66, time * .016, .18 * intensity, .8, [9, 13]);
      this.ring(ctx, this.radius * .92, .34, -.82, -time * .013, .22 * intensity, .7, [3, 8]);

      const orbit = time * .00032;
      for (let i = 0; i < 7; i += 1) {
        this.arcRing(ctx, this.radius * (1.16 - i * .038), .72 + i * .025, orbit * (i % 2 ? -1 : 1) + i * .48, orbit * 7 + i, .54 + (i % 3) * .6, (.15 + (i % 3) * .08) * intensity, i % 3 === 0 ? 1.6 : .8);
      }

      this.drawSphereGrid(ctx, time, intensity);
      this.drawNodes(ctx, time, intensity);
      this.drawParticles(ctx, time, intensity);
      this.drawCore(ctx, time, intensity);

      const scanY = this.cy + Math.sin(time * .00062) * this.radius * .9;
      const scan = ctx.createLinearGradient(this.cx - this.radius, scanY, this.cx + this.radius, scanY);
      scan.addColorStop(0, 'rgba(255,170,20,0)');
      scan.addColorStop(.5, `rgba(255,195,77,${.11 * intensity})`);
      scan.addColorStop(1, 'rgba(255,170,20,0)');
      ctx.strokeStyle = scan;
      ctx.beginPath();
      ctx.moveTo(this.cx - this.radius, scanY);
      ctx.lineTo(this.cx + this.radius, scanY);
      ctx.stroke();

      requestAnimationFrame((nextTime) => this.draw(nextTime));
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.jarvisHologram = new JarvisHologram(document.getElementById('hologram'));
  });
})();
