import type { CourseModule } from "@mybrandos/shared";

export function CourseStructure({
  modules,
  selectedModuleId,
  selectedLessonId,
  canEdit,
  onSelect,
  onAddModule,
  onAddLesson,
  onRenameModule,
  onRenameLesson,
  onDeleteModule,
  onDeleteLesson,
  onDuplicateLesson,
  onMoveModule,
  onMoveLesson,
}: {
  modules: CourseModule[];
  selectedModuleId: string | null;
  selectedLessonId: string | null;
  canEdit: boolean;
  onSelect: (moduleId: string, lessonId?: string) => void;
  onAddModule: () => void;
  onAddLesson: (moduleId: string) => void;
  onRenameModule: (moduleId: string, title: string) => void;
  onRenameLesson: (lessonId: string, title: string) => void;
  onDeleteModule: (moduleId: string) => void;
  onDeleteLesson: (lessonId: string) => void;
  onDuplicateLesson: (lessonId: string) => void;
  onMoveModule: (orderedIds: string[]) => void;
  onMoveLesson: (moduleId: string, orderedIds: string[]) => void;
}) {
  function move(ids: string[], id: string, dir: -1 | 1) {
    const index = ids.indexOf(id);
    if (index < 0) return ids;
    const next = index + dir;
    if (next < 0 || next >= ids.length) return ids;
    const copy = [...ids];
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    return copy;
  }

  return (
    <aside className="book-structure">
      <div className="eyebrow">Course structure</div>
      {canEdit ? <button className="btn ghost" onClick={onAddModule}>Add module</button> : null}
      {modules.map((module) => (
        <div key={module.id} className="book-struct-group">
          <div className={`book-node${selectedModuleId === module.id && !selectedLessonId ? " active" : ""}`}>
            <button className="text-link" onClick={() => onSelect(module.id)}>{module.title}</button>
            {canEdit ? (
              <div className="book-node-actions">
                <button onClick={() => onMoveModule(move(modules.map((m) => m.id), module.id, -1))}>↑</button>
                <button onClick={() => onMoveModule(move(modules.map((m) => m.id), module.id, 1))}>↓</button>
                <button onClick={() => {
                  const title = window.prompt("Module title", module.title);
                  if (title) onRenameModule(module.id, title);
                }}>Rename</button>
                <button onClick={() => onDeleteModule(module.id)}>Delete</button>
              </div>
            ) : null}
          </div>
          {module.lessons.map((lesson) => (
            <div key={lesson.id} className={`book-node indent${selectedLessonId === lesson.id ? " active" : ""}`}>
              <button className="text-link" onClick={() => onSelect(module.id, lesson.id)}>
                {lesson.title} <span className="small muted">{lesson.lessonType}</span>
              </button>
              {canEdit ? (
                <div className="book-node-actions">
                  <button onClick={() => onMoveLesson(module.id, move(module.lessons.map((l) => l.id), lesson.id, -1))}>↑</button>
                  <button onClick={() => onMoveLesson(module.id, move(module.lessons.map((l) => l.id), lesson.id, 1))}>↓</button>
                  <button onClick={() => {
                    const title = window.prompt("Lesson title", lesson.title);
                    if (title) onRenameLesson(lesson.id, title);
                  }}>Rename</button>
                  <button onClick={() => onDuplicateLesson(lesson.id)}>Duplicate</button>
                  <button onClick={() => onDeleteLesson(lesson.id)}>Delete</button>
                </div>
              ) : null}
            </div>
          ))}
          {canEdit ? (
            <button className="book-add-section" onClick={() => onAddLesson(module.id)}>Add lesson</button>
          ) : null}
        </div>
      ))}
    </aside>
  );
}
