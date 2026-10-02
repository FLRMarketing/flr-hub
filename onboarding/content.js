/* ============================================================================
   FLR Onboarding: the words on each task, taken from FLR's source forms.
   - FLR Group New Starter Information Form (supplied 2 Oct 2026)
   - FLR Medical Questionnaire Oct22
   - FLR Working Time Regulations (1998) Opt Out Form, Jan23
   - FLR Group Employee Health and Safety Induction Training Record
   - HSE Display screen equipment (DSE) workstation checklist, published 05/13
     (Open Government Licence)
   Wording quoted from a form is marked `source`; keep it exactly as the form
   says. The HMRC starter checklist is NOT reproduced here: the task links to
   HMRC's own form on GOV.UK. Nothing in this file is private.
   ========================================================================== */
window.ONB = (function () {
  'use strict';

  const TASKS = {
    new_starter: { title: 'New Starter Information', text: 'Your personal, emergency contact, bank, qualification and work history details.', group: 'about' },
    contract: { title: 'Employment contract', text: 'Read your contract of employment and sign it.', group: 'agree' },
    handbook: { title: 'Employee Handbook', text: 'Read the handbook and confirm you’ve received and understood it.', group: 'agree' },
    medical: { title: 'Medical questionnaire', text: 'Your health history. Only authorised HR staff can read your answers.', group: 'about' },
    tax: { title: 'P45 or HMRC Starter Checklist', text: 'Tell payroll whether you have a P45 from your last job.', group: 'about' },
    hmrc: { title: 'HMRC Starter Checklist', text: 'HMRC’s official form, if payroll needs it from you.', group: 'about' },
    documents: { title: 'Documents and right to work', text: 'Evidence of your right to work in the UK, and anything else FLR needs to see.', group: 'docs' },
    driving: { title: 'Driving documents', text: 'Your full driving licence, checked before you drive for FLR.', group: 'docs' },
    qualifications: { title: 'Qualifications and certificates', text: 'Evidence of the qualifications and cards your role needs.', group: 'docs' },
    ppe: { title: 'PPE and uniform', text: 'Confirm you’ve received the PPE and uniform issued to you.', group: 'safety' },
    induction: { title: 'Health and Safety Induction', text: 'Your trainer takes you through it in person; then you confirm and sign.', group: 'safety' },
    working_time: { title: 'Working time choice', text: 'Choose to opt out of the 48-hour average working week, or to work within it.', group: 'agree' },
    fitter_info: { title: 'Fitter information', text: 'Absence, holidays, expenses, timesheets and job sign-offs.', group: 'safety' },
    dse: { title: 'DSE workstation assessment', text: 'Check your desk, chair, screen and set-up, with your assessor.', group: 'safety' },
  };
  const GROUPS = [
    { id: 'about', title: 'About you' },
    { id: 'agree', title: 'Your agreements' },
    { id: 'docs', title: 'Documents and checks' },
    { id: 'safety', title: 'Safety and your role' },
  ];

  const STATUS = {
    not_started: 'Not started', in_progress: 'In progress', submitted: 'Submitted', needs_changes: 'Needs changes',
    complete: 'Complete', not_applicable: 'Not applicable',
  };
  // Why a task can't be started yet (shown beside its status).
  const AVAIL = {
    awaiting_document: 'Awaiting FLR document',
    awaiting_approval: 'Awaiting HR approval',
    waiting_payroll: 'Waiting for payroll',
    with_trainer: 'With your trainer',
    waiting_issue: 'Waiting for HR to issue',
    to_sign: 'Ready for you to sign',
  };
  const AVAIL_TEXT = {
    awaiting_document: 'FLR hasn’t added the approved document yet. You’ll be able to do this task as soon as it’s ready.',
    awaiting_approval: 'FLR’s HR team is checking this form’s wording before it goes live.',
    waiting_payroll: 'Payroll will tell you here whether they need HMRC’s starter checklist from you.',
    with_trainer: 'Your trainer will take you through the induction in person and record it here. You’ll then be asked to confirm and sign.',
    waiting_issue: 'HR will list the PPE and uniform issued to you here, for you to confirm.',
    to_sign: 'Your trainer has completed your induction record. Read it, then confirm and sign.',
  };
  const ROUTE = { operative: 'Operative', office: 'Office employee' };

  /* ---------------------------------------------------------------- New Starter Information (FLR Group New Starter Information Form) */
  const NEW_STARTER = {
    source: 'FLR Group New Starter Information Form',
    marital: [
      { v: 'single', label: 'Single' }, { v: 'married', label: 'Married or Civil Partnership' },
      { v: 'widowed', label: 'Widowed' }, { v: 'divorced', label: 'Divorced' },
    ],
    bankNote: 'This bank account will be used for all payments made to you.',   // source: "BANK DETAILS – this bank account will be used for all payments made to you."
    pension: 'You will be automatically entered into the scheme and deductions from your salary will be made, unless you supply Payroll with an opt-out form prior to the relevant payroll deadline.  This opt-out form can be obtained from the pension provider.',   // source, exactly
    declaration: 'I declare that to the best of my knowledge the information given above is correct.',   // source, exactly
    // source: the instructions at the top of the form
    bring: 'On your first day of service please bring your P45, Passport, Driving Licence, along with original certificates of relevant/essential qualifications.',
    rightToWork: 'You will also be required to provide original, relevant documents that show your right to work in the UK PRIOR to your first day of employment.',
  };

  /* ---------------------------------------------------------------- Medical questionnaire (FLR, Oct22) */
  const MEDICAL = {
    source: 'FLR Medical Questionnaire Oct22',
    history: [
      ['h1', 'Disorders of the nervous system including epilepsy, dizziness and light-headedness?'],
      ['h2', 'Disease of the heart or circulation including angina, chest pains, palpitations, swollen ankles, leg cramps or difficulty sleeping?'],
      ['h3', 'Asthma, bronchitis or chest diseases such as persistent cough or breathlessness?'],
      ['h4', 'Other disorders affecting ability to work?'],
      ['h5', 'Ear disease or deafness?'],
      ['h6', 'Eye disorders including colour blindness. Do you wear glasses or contact lenses?'],
      ['h7', 'Have you ever been in hospital for more than 2 days?'],
      ['h8', 'Are you taking any drugs or medicines? If yes, please give details.'],
      ['h9', 'Drug or alcohol misuse including failure of a Drugs and Alcohol test?'],
      ['h10', 'Have you ever had an illness or condition caused by your work?'],
      ['h11', 'Have you ever been away from work for at least two weeks due to illness in the past two years?'],
      ['h12', 'Have you ever been exposed to large amounts of lead? If yes, please give details and dates.'],
      ['h13', 'Have you ever suffered any effects from being in contact with lead?  If yes, please give details.'],
      ['h14', 'Do you suffer from any health problem or disability, which is relevant to your job or proposed job?'],
    ],
    evidence: '* Evidence details required',   // source, under National Insurance No* and Date of Birth*
    declaration: 'I confirm that all the information provided is true to the best of my knowledge and I agree to FLR Group retaining this information subject to their Data Protection Policy.',   // source
  };

  /* ---------------------------------------------------------------- Working time (FLR WTR (1998) opt-out form, Jan23); all source */
  const WORKING_TIME = {
    source: 'FLR Working Time Regulations (1998) Opt Out Form, Jan23',
    title: 'Working Time Regulations (1998) opt out form',
    intro: 'If you wish to work within or opt out of the Working Time Regulations (1998) relating to working an average of 48 hours per week, please signify your option below by ticking the appropriate box.',
    rule: 'The Working Time Regulations (1998) restrict the hours that employees may work to a limit of an average of 48 hours per week (averaged over a 17 week period) including overtime and any additional employment outside of the FLR Group.',
    a: { title: 'Option A – Opt Out Of The Limits', text: 'I wish to waive my right to be limited to working an average of 48 hours per week under Regulation 5 of the Working Time Regulations (1998) and choose to opt out of these regulations.' },
    b: { title: 'Option B – Work Up To The Limits', text: 'I wish to comply with the 48-hour average working week under Regulation 5 of the Working Time Regulations (1998). I understand this means I cannot work in excess of these limits even if I choose, without signing a new declaration.' },
    tick: '(Tick one only)',
    withdraw: 'If you have opted out of the limits (Option A) and you subsequently wish to withdraw that waiver, you can do so by giving the Company 4 weeks’ written notice. Notice may be given by the signing of a new Working Time Regulations (1998) opt out form or by submitting a signed, written letter.',
  };

  // The fitter information page's words come from the database (they include a named contact and a mobile number, which
  // don't belong on this public site). This sentence is also shown on the driving documents task.
  const DRIVING_NOTE = 'FLR requires a copy of your full driving licence for checks before you use a company vehicle.';

  /* ---------------------------------------------------------------- H&S induction (FLR Group Employee H&S Induction Training Record); questions are source */
  const INDUCTION = {
    source: 'FLR Group Employee Health and Safety Induction Training Record',
    intro: 'Health and Safety training is a legal requirement for all new members of staff. It is therefore, company policy to ensure that all new employees are given sufficient information, instruction and training to enable them to carry out their duties in safety and with minimum risk to themselves and others who may be affected by their or our activities.',
    sections: [
      { title: 'Fire safety', items: [
        ['fs1', 'Has the fire warning system been explained to you? (location of call points etc.)'],
        ['fs2', 'Has the means of escape been demonstrated to you from the areas in which you will work?'],
        ['fs3', 'Have you been shown the location of the fire assembly point where you must report in the event of a fire or emergency evacuation?'],
        ['fs4', 'Has the action to be taken in the event of a fire been made clear?'],
        ['fs5', 'Has the location of the nearest fire fighting equipment been shown?'],
        ['fs6', 'Has the periodic fire drill been explained?'],
        ['fs7', 'Has the necessity for keeping fire doors closed been emphasised?'],
        ['fs8', 'Has the relevant Fire, First Aid and Emergency contacts notice attached to this training record been completed and explained to you?'],
      ] },
      { title: 'First aid', items: [
        ['fa1', 'Have the emergency first aid procedures been explained?'],
        ['fa2', 'Has the location of the nearest first aid kit been shown?'],   // the form says "Had"
        ['fa3', 'Do you know who to contact if you or someone else needs first aid?'],
        ['fa4', 'Have the procedures for reporting accidents and incidents been explained?'],
        ['fa5', 'Is the Accident Book readily available to you?'],
      ] },
      { title: 'Welfare facilities', items: [
        ['wf1', 'Have the facilities for taking rest breaks been explained to you?'],
        ['wf2', 'Have you been made aware of where you may eat and drink?'],
        ['wf3', 'Have you been shown the location of the toilet facilities?'],
        ['wf4', 'Have you been shown the location of hand-washing facilities?'],
      ] },
      { title: 'General safety', items: [
        ['gs1', 'Has it been explained to you where to go, who to call, who to ask for help and advice regarding safety issues?'],
        ['gs2', 'Have you undertaken a tour of the workplace?'],
        ['gs3', 'Do you know what to do to report defective equipment?'],
        ['gs4', 'Has the hazard reporting procedure been explained to you?'],
        ['gs5', 'Have you been made aware of the risks associated with work tasks that you are expected to carry out?'],
        ['gs6', 'Has it been made clear that gangways, exits etc. must always be kept clear of obstructions?'],
        ['gs7', 'Have those areas that have restricted access (if any) been explained?'],
        ['gs8', 'Has the meaning of any safety signs (if relevant) been explained?'],
        ['gs9', 'Have the rules on smoking been explained to you?'],
        ['gs10', 'Has the necessity for wearing any protective clothing been made clear (if relevant)? Have you signed for receipt of this equipment?'],
        ['gs11', 'Has relevant H&S training been arranged where required?'],
        ['gs12', 'Have you been made aware of, read and understood our H&S policy?'],
      ] },
    ],
    closing: 'Think safely. Do not do anything that you are not trained to do. Workplaces can be dangerous places. Slips, trips and falls are a major accident cause. Ensure that your work area is kept clean and tidy at all times.',
    ask: 'IF IN DOUBT ASK YOUR SUPERVISOR OR LINE MANAGER!',
    copyName: 'Re-enter name to confirm that a completed copy of this checklist was handed to the new employee:',
    acknowledge: 'A printed copy of this checklist will be retained in your personnel file. Please sign here to acknowledge that you have received and understood this induction training.',
    young: {
      title: 'Information for Young Persons (16 – 18 year olds)',
      points: [
        'Young persons are not allowed to operate any equipment unless they have received formal instruction and training on its use and safe operation.',
        'The Health and Safety policy that has been issued to you contains further information that you should read and UNDERSTAND.',
      ],
      then: 'If you are unsure on any aspect of your job or the information you have been given, you should ask your Supervisor immediately.',
      ask: 'Do not ASSUME anything - ASK FIRST!!',
    },
  };

  /* ---------------------------------------------------------------- DSE (HSE workstation checklist, 05/13, OGL); questions and things to consider are source */
  const DSE = {
    source: 'HSE Display screen equipment (DSE) workstation checklist, published 05/13',
    licence: 'Contains public sector information published by the Health and Safety Executive and licensed under the Open Government Licence.',
    how: [
      '‘Yes’ answers require no further action.',
      '‘No’ answers will require investigation and/or remedial action by the workstation assessor. They should record their decisions in the ‘Action to take’ column.',
      'Assessors should check later that actions have been taken and have resolved the problem.',
    ],
    sections: [
      { title: '1 Keyboards', items: [
        ['k1', 'Is the keyboard separate from the screen?', 'This is a requirement, unless the task makes it impracticable (eg where there is a need to use a portable).'],
        ['k2', 'Does the keyboard tilt?', 'Tilt need not be built in.'],
        ['k3', 'Is it possible to find a comfortable keying position?', 'Try pushing the display screen further back to create more room for the keyboard, hands and wrists. Users of thick, raised keyboards may need a wrist rest.'],
        ['k4', 'Does the user have good keyboard technique?', 'Training can be used to prevent: hands bent up at the wrist; hitting the keys too hard; overstretching the fingers.'],
        ['k5', 'Are the characters clear and readable?', 'Keyboards should be kept clean. If characters still can’t be read, the keyboard may need modifying or replacing. Use a keyboard with a matt finish to reduce glare and/or reflection.'],
      ] },
      { title: '2 Mouse, trackball etc', items: [
        ['m1', 'Is the device suitable for the tasks it is used for?', 'If the user is having problems, try a different device. The mouse and trackball are general-purpose devices suitable for many tasks, and available in a variety of shapes and sizes. Alternative devices such as touch screens may be better for some tasks (but can be worse for others).'],
        ['m2', 'Is the device positioned close to the user?', 'Most devices are best placed as close as possible, eg right beside the keyboard. Training may be needed to: prevent arm overreaching; encourage users not to leave their hand on the device when it is not being used; encourage a relaxed arm and straight wrist.'],
        ['m3', 'Is there support for the device user’s wrist and forearm?', 'Support can be gained from, for example, the desk surface or arm of a chair. If not, a separate supporting device may help. The user should be able to find a comfortable working position with the device.'],
        ['m4', 'Does the device work smoothly at a speed that suits the user?', 'See if cleaning is required (eg of mouse ball and rollers). Check the work surface is suitable. A mouse mat may be needed.'],
        ['m5', 'Can the user easily adjust software settings for speed and accuracy of pointer?', 'Users may need training in how to adjust device settings.'],
      ] },
      { title: '3 Display screens', items: [
        ['s1', 'Are the characters clear and readable?', 'Make sure the screen is clean and cleaning materials are available. Check that the text and background colours work well together.'],
        ['s2', 'Is the text size comfortable to read?', 'Software settings may need adjusting to change text size.'],
        ['s3', 'Is the image stable, ie free of flicker and jitter?', 'Try using different screen colours to reduce flicker, eg darker background and lighter text. If there are still problems, get the set-up checked, eg by the equipment supplier.'],
        ['s4', 'Is the screen’s specification suitable for its intended use?', 'For example, intensive graphic work or work requiring fine attention to small details may require large display screens.'],
        ['s5', 'Are the brightness and/or contrast adjustable?', 'Separate adjustment controls are not essential, provided the user can read the screen easily at all times.'],
        ['s6', 'Does the screen swivel and tilt?', 'Swivel and tilt need not be built in; you can add a swivel and tilt mechanism. However, you may need to replace the screen if: swivel/tilt is absent or unsatisfactory; work is intensive; and/or the user has problems getting the screen to a comfortable position.'],
        ['s7', 'Is the screen free from glare and reflections?', 'Use a mirror placed in front of the screen to check where reflections are coming from. You might need to move the screen or even the desk and/or shield the screen from the source of the reflections. Screens that use dark characters on a light background are less prone to glare and reflections.'],
        ['s8', 'Are adjustable window coverings provided and in adequate condition?', 'Check that blinds work. Blinds with vertical slats can be more suitable than horizontal ones. If these measures do not work, consider anti-glare screen filters as a last resort and seek specialist help.'],
      ] },
      { title: '4 Software', items: [
        ['w1', 'Is the software suitable for the task?', 'Software should help the user carry out the task, minimise stress and be user-friendly. Check users have had appropriate training in using the software. Software should respond quickly and clearly to user input, with adequate feedback, such as clear help messages.'],
      ] },
      { title: '5 Furniture', items: [
        ['f1', 'Is the work surface large enough for all the necessary equipment, papers etc?', 'Create more room by moving printers, reference materials etc elsewhere. If necessary, consider providing new power and telecoms sockets, so equipment can be moved. There should be some scope for flexible rearrangement.'],
        ['f2', 'Can the user comfortably reach all the equipment and papers they need to use?', 'Rearrange equipment, papers etc to bring frequently used things within easy reach. A document holder may be needed, positioned to minimise uncomfortable head and eye movements.'],
        ['f3', 'Are surfaces free from glare and reflection?', 'Consider mats or blotters to reduce reflections and glare.'],
        ['f4', 'Is the chair suitable?', 'The chair may need repairing or replacing if the user is uncomfortable, or cannot use the adjustment mechanisms.'],
        ['f5', 'Is the chair stable?', 'The chair may need repairing or replacing if the user is uncomfortable, or cannot use the adjustment mechanisms.'],
        ['f6', 'Does the chair have a working: seat back height and tilt adjustment? seat height adjustment? castors or glides?', 'The chair may need repairing or replacing if the user is uncomfortable, or cannot use the adjustment mechanisms.'],
        ['f7', 'Is the chair adjusted correctly?', 'The user should be able to carry out their work sitting comfortably. Consider training the user in how to adopt suitable postures while working. The arms of chairs can stop the user getting close enough to use the equipment comfortably. Move any obstructions from under the desk.'],
        ['f8', 'Is the small of the back supported by the chair’s backrest?', 'The user should have a straight back, supported by the chair, with relaxed shoulders.'],
        ['f9', 'Are forearms horizontal and eyes at roughly the same height as the top of the DSE?', 'Adjust the chair height to get the user’s arms in the right position, and then adjust the DSE height, if necessary.'],
        ['f10', 'Are feet flat on the floor, without too much pressure from the seat on the backs of the legs?', 'If not, a footrest may be needed.'],
      ] },
      { title: '6 Environment', items: [
        ['e1', 'Is there enough room to change position and vary movement?', 'Space is needed to move, stretch and fidget. Consider reorganising the office layout and check for obstructions. Cables should be tidy and not a trip or snag hazard.'],
        ['e2', 'Is the lighting suitable, eg not too bright or too dim to work comfortably?', 'Users should be able to control light levels, eg by adjusting window blinds or light switches. Consider shading or repositioning light sources or providing local lighting, eg desk lamps (but make sure lights don’t cause glare by reflecting off walls or other surfaces).'],
        ['e3', 'Does the air feel comfortable?', 'DSE and other equipment may dry the air. Circulate fresh air if possible. Plants may help. Consider a humidifier if discomfort is severe.'],
        ['e4', 'Are levels of heat comfortable?', 'Can heating be better controlled? More ventilation or air conditioning may be required if there is a lot of electronic equipment in the room. Or, can users be moved away from the heat source?'],
        ['e5', 'Are levels of noise comfortable?', 'Consider moving sources of noise, eg printers, away from the user. If not, consider soundproofing.'],
      ] },
      { title: '7 Final questions to users', items: [
        ['q1', 'Has the checklist covered all the problems they may have working with their DSE?', ''],
        ['q2', 'Have they experienced any discomfort or other symptoms which they attribute to working with their DSE?', ''],
        ['q3', 'Has the user been advised of their entitlement to eye and eyesight testing?', ''],
        ['q4', 'Does the user take regular breaks working away from DSE?', ''],
      ] },
    ],
    concern: { q2: 'yes' },   // the answer that needs action; 'no' for every other question
    problems: 'Write down the details of any problems here:',
  };

  /* ---------------------------------------------------------------- HMRC: links only, never the form's questions */
  const HMRC = {
    page: 'https://www.gov.uk/government/publications/paye-starter-checklist',
    online: 'https://www.tax.service.gov.uk/guidance/check-what-information-to-give-your-new-employer',
    // Quoted from the official form's "Instructions for employee" and its first page (HMRC 12/25), with attribution.
    instructions: 'Fill in this form if you do not have a P45 (a document you get from your employer when you stop working for them). You should also fill in this form if you have a student loan (whether or not you’ve a P45).',
    notToHmrc: 'Do not send this form to HM Revenue and Customs (HMRC)',
  };

  // Right-to-work check methods (UK Home Office guidance), and the other documents' checks.
  const CHECK_METHODS = {
    rtw: ['Manual check of original documents', 'Home Office online check (share code)', 'Identity service provider (IDSP) digital check'],
    licence: ['Original licence seen and copied', 'DVLA online check (check code)'],
    address: ['Original document seen and copied'],
    qual: ['Original certificate seen and copied', 'Checked with the awarding body', 'Card checked online (scheme register)'],
  };
  const ITEMS = {
    rtw: { title: 'Right-to-work evidence', text: 'A passport or other document that shows your right to work in the UK, or a Home Office share code if you have one.' },
    address: { title: 'Proof of address', text: 'For your DBS check: a document showing your address, dated within the last three months (for example a utility bill or bank statement).' },
    licence: { title: 'Full driving licence', text: 'Both sides of your photocard licence.' },
  };
  const QUAL_STATUS = { awaiting_evidence: 'Awaiting evidence', uploaded: 'Uploaded', original_required: 'Original required', verified: 'Verified', needs_replacement: 'Needs replacement' };
  const UPLOAD_STATUS = { requested: 'Requested', uploaded: 'Uploaded', needs_replacement: 'Needs replacement' };
  const INTERNAL_STATUS = { required: 'Required', not_required: 'Not required', waiting: 'Waiting', complete: 'Complete' };
  const NEEDS = [
    ['drives', 'Company vehicle or driving for work', 'Adds driving documents, and the vehicle, fuel card, Quartix, mileage, tracker and licence checks'],
    ['ppe', 'PPE or uniform', 'Adds PPE and uniform receipt', true],
    ['quals', 'Qualifications or competency cards', 'Adds qualifications and certificates', true],
    ['tools', 'Uses tools that need PAT testing', 'Adds PAT testing to the internal checklist', true],
    ['phone', 'Company phone', 'Adds a company phone to the internal checklist'],
    ['companyEmail', 'Company email address', 'Adds creating their email address to the internal checklist'],
    ['dbs', 'DBS check', 'Adds proof of address and the DBS steps'],
  ];
  const DOC_KINDS = {
    contract: 'Employment contract', handbook: 'Employee Handbook', hs_policy: 'Health and Safety Policy', emergency_notice: 'Fire, First Aid and Emergency contacts notice',
  };
  const AUDIT = {
    'starter.added': 'Added as a new starter', 'starter.updated': 'Details or route changed', 'starter.archived': 'Archived', 'starter.restored': 'Restored',
    'task.saved': 'Saved a draft', 'task.submitted': 'Submitted', 'task.accepted': 'Accepted', 'task.changes': 'Asked for changes',
    'contract.signed': 'Signed the contract', 'handbook.signed': 'Acknowledged the handbook', 'fitter_info.signed': 'Acknowledged the fitter information',
    'ppe.signed': 'Confirmed PPE received', 'induction.signed': 'Signed the induction record', 'pension.shown': 'Was shown the pension information',
    'file.uploaded': 'Uploaded a file', 'file.removed': 'Removed a file', 'file.viewed': 'Opened a file', 'code.saved': 'Saved a check code',
    'document.verify': 'Recorded a document check', 'document.follow_up': 'Recorded a check with a follow-up', 'document.replace': 'Asked for a replacement document',
    'qualification.add': 'Added a qualification', 'qualification.update': 'Changed a qualification', 'qualification.remove': 'Removed a qualification',
    'qualification.require': 'Required a qualification', 'qualification.unrequire': 'Removed a required qualification', 'qualification.check': 'Checked a qualification',
    'payroll.updated': 'Payroll updated P45 / checklist', 'pay.updated': 'Pay details updated', 'bank.viewed': 'Bank details opened', 'medical.viewed': 'Medical answers opened',
    'dse.action.add': 'Added a DSE action', 'dse.action.resolve': 'Resolved a DSE action', 'dse.action.reopen': 'Reopened a DSE action',
    'induction.item': 'Recorded an induction item', 'induction.young': 'Young-person information explained', 'induction.finish': 'Completed the induction (trainer)', 'induction.reopen': 'Reopened the induction',
    'ppe.add': 'Added PPE issued', 'ppe.remove': 'Removed PPE', 'ppe.issue': 'Sent PPE list to confirm', 'internal.updated': 'Internal checklist updated',
    'doc.uploaded': 'Uploaded a document version', 'doc.approve': 'Approved a document version', 'doc.retire': 'Retired a document version',
  };

  return { TASKS, GROUPS, STATUS, AVAIL, AVAIL_TEXT, ROUTE, NEW_STARTER, MEDICAL, WORKING_TIME, DRIVING_NOTE, INDUCTION, DSE, HMRC, CHECK_METHODS, ITEMS,
    QUAL_STATUS, UPLOAD_STATUS, INTERNAL_STATUS, NEEDS, DOC_KINDS, AUDIT };
})();
