import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { ChangeDetectorRef } from '@angular/core';

type Mood = 'happy' | 'normal' | 'tired' | 'sad';
type Energy = 'LOW' | 'MEDIUM' | 'HIGH';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './mood.html',
  styleUrls: ['./mood.css'],
})
export class MoodPage implements OnInit {
  selectedMood: Mood | '' = '';
  selectedEnergy: Energy | '' = '';

  saving = false;
  error = '';

  toastOpen = false;
  toastText = '';
  toastEmoji = '✅';

  constructor(
    private api: ApiService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.load();
  }

  
  load(): void {
    this.api.get<any>('/users/me', { auth: true }).subscribe({
      next: (res) => {
        const u = res?.user ?? res;

     
        if (u?.mood) this.selectedMood = String(u.mood).toLowerCase() as Mood;
        if (u?.energy) this.selectedEnergy = String(u.energy).toUpperCase() as Energy;
      },
      error: (err) => {

      },
    });
  }

  selectMood(m: Mood): void {
    this.selectedMood = m;
    this.error = '';
  }

  selectEnergy(e: Energy): void {
    this.selectedEnergy = e;
    this.error = '';
  }

  save(): void {
    if (!this.selectedMood || !this.selectedEnergy) {
      this.error = 'Please choose mood and energy 🙂';
      this.toastEmoji = '⚠️';
      this.openToast('Pick both mood + energy first.', true);
      return;
    }
  
    this.saving = true;
    this.error = '';
  
    const body = {
      mood: String(this.selectedMood).toUpperCase(),
      energy: String(this.selectedEnergy).toUpperCase(),
    };
  
    this.api.post<any>('/users/me', body, { auth: true })
      .subscribe({
        next: () => {
  
          
          setTimeout(() => {
            this.saving = false;
            this.toastEmoji = '✅';
            this.toastOpen = true;
            this.toastText = 'Your mood & energy were saved.';
  
         
            this.cdr.detectChanges();
          }, 0);
  
        },
        error: (err) => {
  
          setTimeout(() => {
            console.error('SAVE ERROR:', err);
            this.saving = false;
  
            if (err?.status === 401) {
              this.error = 'You are not logged in. Please login first.';
              this.toastEmoji = '⚠️';
              this.toastText = 'Login first (missing token).';
              this.toastOpen = true;
              this.cdr.detectChanges();
              return;
            }
  
            this.error = 'Could not save. Please try again.';
            this.toastEmoji = '⚠️';
            this.toastText = 'Could not save (server error).';
            this.toastOpen = true;
  
            this.cdr.detectChanges();
          }, 0);
        }
      });
  }

  
  closeToast(): void {
    this.toastOpen = false;
  }

  goHome(): void {
    this.router.navigateByUrl('/home');
  }

  
  moodLabel(m: Mood | ''): string {
    if (!m) return '—';
    const map: Record<Mood, string> = {
      happy: 'Happy',
      normal: 'Normal',
      tired: 'Tired',
      sad: 'Sad',
    };
    return map[m];
  }

  energyLabel(e: Energy | ''): string {
    if (!e) return '—';
    const map: Record<Energy, string> = {
      LOW: 'Low',
      MEDIUM: 'Medium',
      HIGH: 'High',
    };
    return map[e];
  }

  private openToast(msg: string, autoClose: boolean): void {
    this.toastText = msg;
    this.toastOpen = true;

    if (autoClose) {
      setTimeout(() => (this.toastOpen = false), 2500);
    }
  }
}