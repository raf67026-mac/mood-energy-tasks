import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

type Energy = 'LOW' | 'MEDIUM' | 'HIGH';
type MoodValue = 'happy' | 'normal' | 'tired' | 'sad';
type MoodApi = MoodValue | 'NEUTRAL';
type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

type Task = {
  id: number;
  title: string;
  duration: number;
  energyLevel: Energy;
  status: TaskStatus;
};

type TasksResponse = { tasks: Task[] };

type MeResponse = {
  user?: {
    id: number;
    name?: string | null;
    username?: string | null;
    mood?: MoodApi | null;
    energy?: Energy | null;
  };
};

type MoodGetResponse = {
  mood?: MoodApi | null;
  energy?: Energy | null;
};

type MeSnapshot = {
  name?: string;
  mood?: MoodValue | '';
  energy?: Energy | '';
};

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './home.html',
  styleUrls: ['./home.css'],
})
export class Home implements OnInit {
  meName = '';
  todayMood: MoodValue | '' = '';
  todayEnergy: Energy | '' = '';

  loading = false;
  error = '';

  statusFilter: 'ALL' | TaskStatus = 'ALL';

  tasks: Task[] = [];
  highTasks: Task[] = [];
  mediumTasks: Task[] = [];
  lowTasks: Task[] = [];

  completedCount = 0;
  inProgressCount = 0;
  pendingCount = 0;

  toastOpen = false;
  toastText = '';
  private toastTimer: any = null;

  // modal lane
  expandedLane: Energy | 'STATUS' | '' = '';

  // for undo
  private lastStatusMap = new Map<number, TaskStatus>();

  constructor(private api: ApiService, private router: Router, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.applyLocalMeSnapshot();
    this.loadMe();
    this.loadTasks();
  }

  // ---------------------------
  // Helpers
  // ---------------------------
  private normalizeMood(v: any): MoodValue | '' {
    if (!v) return '';
    if (v === 'NEUTRAL') return 'normal';
    if (v === 'happy' || v === 'normal' || v === 'tired' || v === 'sad') return v;
    return '';
  }

  private normalizeEnergy(v: any): Energy | '' {
    if (!v) return '';
    if (v === 'LOW' || v === 'MEDIUM' || v === 'HIGH') return v;
    return '';
  }

  private applyLocalMeSnapshot(): void {
    try {
      const raw = localStorage.getItem('me_snapshot');
      if (!raw) return;
      const snap = JSON.parse(raw) as MeSnapshot;

      if (snap?.name) this.meName = String(snap.name);
      if (snap?.mood) this.todayMood = snap.mood;
      if (snap?.energy) this.todayEnergy = snap.energy;
    } catch {}
  }

  private saveLocalMeSnapshot(): void {
    try {
      const snap: MeSnapshot = {
        name: this.meName,
        mood: this.todayMood,
        energy: this.todayEnergy,
      };
      localStorage.setItem('me_snapshot', JSON.stringify(snap));
    } catch {}
  }

  // ---------------------------
  // Load Me
  // ---------------------------
  loadMe(): void {
    const applyFromUser = (res: MeResponse) => {
      const u = res?.user;
      if (!u) return;

      this.meName = (u.name || u.username || '').trim();
      const m = this.normalizeMood(u.mood);
      const e = this.normalizeEnergy(u.energy);

      if (m) this.todayMood = m;
      if (e) this.todayEnergy = e;

      this.saveLocalMeSnapshot();
    };

    this.api.get<MeResponse>('/users/me', { auth: true }).subscribe({
      next: (res) => {
        applyFromUser(res);
        setTimeout(() => this.cdr.detectChanges(), 0);
      },
      error: () => {
        // fallback: /mood
        this.api.get<MoodGetResponse>('/mood', { auth: true }).subscribe({
          next: (res) => {
            const m = this.normalizeMood(res?.mood);
            const e = this.normalizeEnergy(res?.energy);
            if (m) this.todayMood = m;
            if (e) this.todayEnergy = e;
            this.saveLocalMeSnapshot();
            setTimeout(() => this.cdr.detectChanges(), 0);
          },
          error: () => {},
        });
      },
    });
  }

  // ---------------------------
  // Tasks
  // ---------------------------
  loadTasks(): void {
    this.loading = true;
    this.error = '';

    this.api.get<TasksResponse>('/tasks', { auth: true }).subscribe({
      next: (res) => {
        const raw = Array.isArray((res as any)?.tasks) ? (res as any).tasks : (Array.isArray(res as any) ? (res as any) : []);
        this.tasks = raw.map((x: any) => this.normalizeTask(x));
        this.recompute();
        setTimeout(() => {
          this.loading = false;
          this.cdr.detectChanges();
        }, 0);
      },
      error: () => {
        this.error = 'Could not load tasks.';
        this.tasks = [];
        this.recompute();
        setTimeout(() => {
          this.loading = false;
          this.cdr.detectChanges();
        }, 0);
      },
    });
  }


  private normalizeTask(x: any): Task {
    const id = typeof x?.id === 'string' ? parseInt(x.id, 10) : Number(x?.id ?? 0);

    const title = (x?.title ?? x?.name ?? x?.taskTitle ?? '').toString();

    const duration = Number(
      x?.duration ?? x?.durationHours ?? x?.hours ?? x?.estimatedHours ?? 0
    );

    const energyRaw = (x?.energyLevel ?? x?.energy ?? x?.energy_level ?? x?.energyLevelName ?? '').toString().toUpperCase();
    const energyLevel: Energy =
      energyRaw === 'HIGH' ? 'HIGH' : energyRaw === 'MEDIUM' ? 'MEDIUM' : 'LOW';

    const statusRaw = (x?.status ?? x?.state ?? '').toString().toUpperCase();
    const status: TaskStatus =
      statusRaw === 'IN_PROGRESS' ? 'IN_PROGRESS' : statusRaw === 'COMPLETED' ? 'COMPLETED' : 'PENDING';

    return { id, title, duration, energyLevel, status };
  }

  private recompute(): void {
    // lane cards always show all tasks (not affected by top status chips)
    this.highTasks = this.tasks.filter((t) => t.energyLevel === 'HIGH');
    this.mediumTasks = this.tasks.filter((t) => t.energyLevel === 'MEDIUM');
    this.lowTasks = this.tasks.filter((t) => t.energyLevel === 'LOW');

    // counts from all tasks
    this.completedCount = this.tasks.filter((t) => t.status === 'COMPLETED').length;
    this.inProgressCount = this.tasks.filter((t) => t.status === 'IN_PROGRESS').length;
    this.pendingCount = this.tasks.filter((t) => t.status === 'PENDING').length;
  }

  setStatusFilter(v: 'ALL' | TaskStatus): void {
    this.statusFilter = v;
    this.recompute();
    this.closeToast();
  }

  // ---------------------------
  // Modal lane
  // ---------------------------
  openLane(e: Energy): void {
    this.expandedLane = e;
    // energy modal always starts unfiltered
    this.statusFilter = 'ALL';
    this.closeToast();
  }

  openStatus(s: 'ALL' | TaskStatus): void {
    this.statusFilter = s;
    this.expandedLane = 'STATUS';
    this.closeToast();
  }

  closeLane(): void {
    const wasStatus = this.expandedLane === 'STATUS';
    this.expandedLane = '';
    if (wasStatus) {
      this.statusFilter = 'ALL';
      this.recompute();
    }
  }

  get activeTasks(): Task[] {
    if (this.expandedLane === 'STATUS') {
      return this.statusFilter === 'ALL'
        ? this.tasks
        : this.tasks.filter((t) => t.status === this.statusFilter);
    }
    if (this.expandedLane === 'HIGH') return this.highTasks;
    if (this.expandedLane === 'MEDIUM') return this.mediumTasks;
    if (this.expandedLane === 'LOW') return this.lowTasks;
    return [];
  }

  get activeLaneCount(): number {
    return this.activeTasks.length;
  }

  get activeLaneTitle(): string {
    if (this.expandedLane === 'STATUS') {
      if (this.statusFilter === 'ALL') return 'All tasks';
      if (this.statusFilter === 'PENDING') return 'Pending tasks';
      if (this.statusFilter === 'IN_PROGRESS') return 'In progress tasks';
      return 'Completed tasks';
    }
    if (this.expandedLane === 'HIGH') return 'High energy tasks';
    if (this.expandedLane === 'MEDIUM') return 'Medium energy tasks';
    if (this.expandedLane === 'LOW') return 'Low energy tasks';
    return 'Tasks';
  }

  // ---------------------------
  // Status pill
  // ---------------------------
  statusLabel(s: TaskStatus): string {
    if (s === 'PENDING') return 'Pending';
    if (s === 'IN_PROGRESS') return 'In progress';
    return 'Completed';
  }

  statusPillClass(s: TaskStatus): string {
    if (s === 'PENDING') return 'pill pending';
    if (s === 'IN_PROGRESS') return 'pill progress';
    return 'pill done';
  }

  durationLabel(hours: number): string {
    if (!hours && hours !== 0) return '—';
    if (hours === 1) return '1 hour';
    return `${hours} hours`;
  }

  moodLabel(m: MoodValue | ''): string {
    if (!m) return '—';
    const map: Record<MoodValue, string> = { happy: 'Happy', normal: 'Normal', tired: 'Tired', sad: 'Sad' };
    return map[m];
  }

  energyLabel(e: Energy | ''): string {
    if (!e) return '—';
    const map: Record<Energy, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
    return map[e];
  }

  // ---------------------------
  // Task interactions
  // ---------------------------
  onTaskClick(t: Task, ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.toggleStatus(t);
  }

  onTaskDoubleClick(t: Task, ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.router.navigate(['/add-task'], { queryParams: { edit: t.id } });
  }

  private toggleStatus(t: Task): void {
    const prev = t.status;
    this.lastStatusMap.set(t.id, prev);

    let next: TaskStatus = 'PENDING';
    if (prev === 'PENDING') next = 'IN_PROGRESS';
    else if (prev === 'IN_PROGRESS') next = 'COMPLETED';
    else next = 'PENDING';

    t.status = next;
    this.recompute();

    this.api.patch(`/tasks/${t.id}`, { status: next }, { auth: true }).subscribe({
      next: () => this.showToast('Updated'),
      error: () => {
        t.status = prev;
        this.recompute();
        this.showToast('Could not update');
      },
    });
  }

  undoLastStatus(t: Task, ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();

    // If user never toggled the dot, we still "undo" by cycling backwards.
    const remembered = this.lastStatusMap.get(t.id);

    const current = t.status;
    const prev: TaskStatus = remembered
      ? remembered
      : current === 'COMPLETED'
      ? 'IN_PROGRESS'
      : current === 'IN_PROGRESS'
      ? 'PENDING'
      : 'PENDING';

    if (prev === current) return;

    t.status = prev;
    this.recompute();

    this.api.patch(`/tasks/${t.id}`, { status: prev }, { auth: true }).subscribe({
      next: () => {
        // clear remembered history once used
        this.lastStatusMap.delete(t.id);
        this.showToast('Undone');
      },
      error: () => {
        t.status = current;
        this.recompute();
        this.showToast('Could not undo');
      },
    });
  }

  // ---------------------------
  // Toast
  // ---------------------------
  closeToast(): void {
    this.toastOpen = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
  }

  private showToast(msg: string): void {
    this.toastText = msg;
    this.toastOpen = true;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastOpen = false), 2000);
  }

  goMood(): void {
    this.router.navigateByUrl('/mood');
  }


  goProfile(): void {
    this.router.navigateByUrl('/edit-profile');
  }


  logout(): void {
    try {
      localStorage.removeItem('token');
    } catch {}
    this.router.navigateByUrl('/auth');
  }

  goAddTask(): void {
    this.router.navigateByUrl('/add-task');
  }


  openChatGPT(): void {
    window.open('https://chat.openai.com', '_blank');
  }


  deleteTask(id: number, ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();

    const before = [...this.tasks];
    this.tasks = this.tasks.filter((t) => t.id !== id);
    this.recompute();

    this.api.delete(`/tasks/${id}`, { auth: true }).subscribe({
      next: () => this.showToast('Deleted'),
      error: () => {
        this.tasks = before;
        this.recompute();
        this.showToast('Could not delete');
      },
    });
  }

}
